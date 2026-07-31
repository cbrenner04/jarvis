import { appendFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { getCurrentHeadAsync } from "../../../shared/git.ts";
import {
  executeWithQuotaFallback,
  type InvocationBinding,
  type InvocationExecution,
} from "../../../shared/invocation/execute.ts";
import { openSessionLog, type SessionLog } from "../../../shared/invocation/session-log.ts";
import { INTENT_SPLIT_PROMPT_ID } from "../../../shared/prompts/intent-split.ts";
import { PLAN_DRAFT_PROMPT_ID } from "../../../shared/prompts/plan-draft.ts";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { renderArtifactTemplate } from "../../../shared/prompts/render.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import {
  type LandingContractRepromptEvent,
  type LogSink,
  type LoopFinishedEvent,
  type PersistedRecord,
  truncateLogText,
} from "../persistence/log-stream.ts";
import {
  type OutcomeKind,
  openStateStore,
  type ReadyGateRepairFenceProvenance,
  type Run,
  type RunStatus,
  type StateStore,
  type WorkflowSnapshot,
} from "../persistence/state-store.ts";
import { type CompletionCommitter, createCompletionCommitter } from "./completion-commit.ts";
import { type CompletionPublisher, createCompletionPublisher } from "./completion-publisher.ts";
import { verifyDiffDerivedMutations } from "./diff-derived-mutation-verifier.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";
import { evaluateIntentSplitLandingGate } from "./intent-output.ts";
import type { InvocationFailureDetail } from "./invocation-failure.ts";
import type { PublicationLanding } from "./publication-landing.ts";
import { type PublicationFailure, publicationFailureFor } from "./publication-retry.ts";
import {
  classifyReadyGateError,
  createReadyFinalizer,
  deriveGateAllowedPaths,
  parseGitNameStatusZ,
  type ReadyFinalizer,
  ReadyFlipError,
  ReadyGateError,
  type ReadyGateScopeInput,
  RuntimeSmokeFailedError,
  readyGateOutOfScopeLogFields,
  SurvivingMutationError,
  survivingMutationLogFields,
  validateRepoRelativePath,
} from "./ready-finalize.ts";
import { type SmokePass, verifyRuntimeSmoke } from "./runtime-smoke-verifier.ts";
import { resolvePublicationTitle } from "./spec-creation-title.ts";
import type { StepRunResult } from "./step-runner.ts";
import { buildJsonlSink } from "./telemetry-sink.ts";
import { reportUncoveredChangedLines } from "./uncovered-changed-lines.ts";
import { type BoundaryStamp, boundaryStampFromStoredRun, emitWorkBoundaryRecorded } from "./work-boundary-telemetry.ts";
import { executeWrite, type WriteExecuteInput } from "./write.ts";

const WRITE_LOOP_OUTCOME_KINDS = [
  "complete",
  "progress",
  "blocked",
  "contract_miss",
  "invocation_failure",
  "iteration_timeout",
  "idle_output_timeout",
  "budget-exhausted",
  "paused",
  "completion_commit_failed",
  "iteration_commit_failed",
  "ready_gate_failed",
  "ready_gate_out_of_scope",
  "ready_flip_failed",
  "surviving_mutation_failed",
  "mutation_repair_exhausted",
  "runtime_smoke_failed",
  "landing_failed",
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
  readyGateOutsidePaths?: string[];
  readyGateOutOfScopeDetail?: string;
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

export type WallSegmentScheduleHandle = { cancel: () => void };
/** Schedules `fire` after `delayMs`; returns a handle to cancel it. Production default is `setTimeout`. */
export type WallSegmentSchedule = (fire: () => void, delayMs: number) => WallSegmentScheduleHandle;

const defaultWallSegmentSchedule: WallSegmentSchedule = (fire, delayMs) => {
  const timer = setTimeout(fire, delayMs);
  return { cancel: () => clearTimeout(timer) };
};

/** Input for the write loop. Run identity derives from `worktree` (project, branch, base). */
export type WriteLoopInput = WriteExecuteInput & {
  maxIterations?: number;
  iterationTimeoutMs?: number;
  iterationCeilingMs?: number;
  /**
   * Bound on waiting for a raced-away invocation to quiesce after an abort/kill or watchdog loss,
   * so an ordinary invocation that ignores its `AbortSignal` cannot hang the loop forever.
   * Finalization repairs ignore this bound and remain joined before terminal settlement.
   */
  quiescenceTimeoutMs?: number;
  /** Test seam: when false, stdout/stderr progress does not re-arm the wall segment. */
  resetIterationWallOnOutput?: boolean;
  /** Test seam: wall-segment scheduling in `awaitIteration`, including `bumpWallSegment` cancel/reschedule. */
  schedule?: WallSegmentSchedule;
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
  /** When true, completion publication skips ready finalization (pipeline leave-draft). */
  skipReadyFinalization?: boolean;
  /** When true, idle-output stall waits for the child process to close (finalization repair). */
  joinProcessOnIdleStall?: boolean;
  /** Test seam: skip persisted-fence enforcement on completed-run retry and resume recovery. */
  bypassPersistedReadyGateRepairFenceForTest?: boolean;
  /** Reprompt context for the next intent-split iteration after a landing-contract miss. */
  landingContractReprompt?: { violation: string; offendingFile: string };
  /** Publication landing contract when invoked from workflow-runner write steps. */
  landing?: PublicationLanding;
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

/** Last in-loop landing-contract reprompt from a run's persisted log tail (resume after pause). */
export function findLandingContractRepromptFromLog(
  logRecords: readonly PersistedRecord[] | undefined,
): WriteLoopInput["landingContractReprompt"] {
  if (logRecords === undefined) return undefined;
  let latest: LandingContractRepromptEvent | undefined;
  for (const record of logRecords) {
    if (record.event.kind === "landing_contract_reprompt") {
      latest = record.event;
    }
  }
  return latest === undefined ? undefined : { violation: latest.violation, offendingFile: latest.offendingFile };
}

const DEFAULT_MAX_ITERATIONS = 10;
const MAX_READY_GATE_REPAIRS = 3;

export { MAX_READY_GATE_REPAIRS };

export type ReadyGateOrigin = "repair_budget_exhausted";
export const MAX_MUTATION_REPAIR_ATTEMPTS = 3;
const READY_GATE_OUTPUT_MAX_CHARS = 16 * 1024;
const COVERAGE_ADVISORY_PROMPT_ID = "write.coverage-advisory";
export const DEFAULT_ITERATION_TIMEOUT_MS = 600_000;
/** Bound on ordinary iteration quiescence; finalization repairs always join without a bound. */
export const DEFAULT_QUIESCENCE_TIMEOUT_MS = 30_000;

/** Run coverage advisory re-prompt when uncovered sites exist. Returns the invocation result or null if no advisory. */
async function runCoverageAdvisory(
  worktreePath: string,
  bindings: readonly InvocationBinding[],
  signal?: AbortSignal,
): Promise<{ responseText: string } | null> {
  try {
    const report = await reportUncoveredChangedLines({ worktreePath, runBase: "HEAD" });
    if (!report.reportText) {
      return null;
    }

    const artifact = loadPromptRegistry().getById(COVERAGE_ADVISORY_PROMPT_ID);
    const prompt = renderArtifactTemplate(artifact, { COVERAGE_REPORT: report.reportText });

    const invocation = await executeWithQuotaFallback({
      prompt,
      cwd: worktreePath,
      bindings,
      ...(signal !== undefined ? { signal } : {}),
    });

    const responseText = invocation.final?.result?.kind === "ok" ? invocation.final.result.stdout.trim() : "";
    return { responseText };
  } catch {
    // Coverage advisory is deliver-only; fail soft
    return null;
  }
}

function stepResponseTextForLog(result: StepRunResult): string {
  if (result.reprompt !== undefined) {
    const repromptFinal = result.reprompt.invocation.final?.result;
    if (repromptFinal?.kind === "ok") {
      return repromptFinal.stdout.trim();
    }
  }
  const final = result.invocation.final?.result;
  return final?.kind === "ok" ? final.stdout.trim() : "";
}

/** `git status --porcelain` paths; fail-soft to [] — diagnostic listing only. */
/** Terminal completion fails closed when the committer produced no sha but the worktree is dirty. */
export function shouldFailTerminalCompletionForDirtyWorktree(
  commitSha: string | undefined,
  uncommittedPaths: readonly string[],
): boolean {
  return commitSha === undefined && uncommittedPaths.length > 0;
}

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

const REPAIR_FENCE_ALLOWSET_SEAMS = { gitUntracked: async () => "\0" };
const REPAIR_FENCE_FAILURE_MESSAGE = "Ready-gate repair stages path outside run diff and spec tree: ";
const REPAIR_FENCE_SIDECAR_FAILURE_MESSAGE = "Ready-gate repair stages harness sidecar: ";
const REPAIR_FENCE_MARKDOWN_ONLY_FAILURE_MESSAGE =
  "Ready-gate repair stages path outside markdown workflow output roots: ";
const REPAIR_FENCE_MISSING_PROVENANCE_MESSAGE = "Ready-gate repair fence could not reconstruct persisted allowset";
const REPAIR_FENCE_MISSING_MARKDOWN_PROVENANCE_MESSAGE =
  "Ready-gate repair fence could not reconstruct persisted markdown workflow output roots";

const MARKDOWN_STAGING_ROOTS: Record<string, string> = {
  [INTENT_SPLIT_PROMPT_ID]: ".jarvis-intent-stage",
  [PLAN_DRAFT_PROMPT_ID]: ".jarvis-plan-stage",
};

function resolveMarkdownOnlyWorkflowPromptId(
  promptId: string | undefined,
  landing?: PublicationLanding,
): string | undefined {
  if (promptId === INTENT_SPLIT_PROMPT_ID || landing?.kind === "intent-stage") {
    return INTENT_SPLIT_PROMPT_ID;
  }
  if (promptId === PLAN_DRAFT_PROMPT_ID || landing?.kind === "plan-tree") {
    return PLAN_DRAFT_PROMPT_ID;
  }
  return undefined;
}

/** Frozen markdown output roots for intent/plan ready-gate repair from the originating write-step contract. */
export function deriveMarkdownOutputRoots(args: {
  promptId: string | undefined;
  specPath: string;
  expectedArtifactPath: string;
  landing?: PublicationLanding;
}): readonly string[] | undefined {
  const workflowPromptId = resolveMarkdownOnlyWorkflowPromptId(args.promptId, args.landing);
  const stagingRoot = workflowPromptId !== undefined ? MARKDOWN_STAGING_ROOTS[workflowPromptId] : undefined;
  if (workflowPromptId === undefined || stagingRoot === undefined) {
    return undefined;
  }
  const roots = new Set<string>();
  const durable =
    workflowPromptId === INTENT_SPLIT_PROMPT_ID
      ? args.landing?.kind === "intent-stage"
        ? args.landing.output.durableDir
        : args.specPath
      : args.landing?.kind === "plan-tree"
        ? args.landing.durablePath
        : args.specPath;
  const normalizedDurable = validateRepoRelativePath(durable);
  if (normalizedDurable !== undefined) {
    roots.add(normalizedDurable);
  }
  const stagingDir =
    workflowPromptId === INTENT_SPLIT_PROMPT_ID
      ? args.landing?.kind === "intent-stage"
        ? args.landing.stagingDir
        : args.expectedArtifactPath
      : args.landing?.kind === "plan-tree"
        ? args.landing.stagingDir
        : args.expectedArtifactPath;
  if (validateRepoRelativePath(stagingDir) === stagingRoot) {
    roots.add(stagingRoot);
  }
  if (roots.size === 0) {
    return undefined;
  }
  return [...roots].sort(compareRepoPathsByUtf8Bytes);
}

async function shouldEnforceReadyGateRepairFence(worktreePath: string): Promise<boolean> {
  try {
    await runRepairFenceGit(worktreePath, ["rev-parse", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

async function runRepairFenceGit(cwd: string, args: readonly string[], env?: Record<string, string>): Promise<string> {
  return realAsyncSubprocessRunner.runAsync("git", [...args], cwd, {
    ...(env !== undefined ? { env: { ...process.env, ...env } } : {}),
  });
}

/** UTF-8 byte order for normalized repository-relative paths. */
export function compareRepoPathsByUtf8Bytes(a: string, b: string): number {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const len = Math.min(aBytes.length, bBytes.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (aBytes[i] ?? 0) - (bBytes[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return aBytes.length - bBytes.length;
}

/** Deterministic escaped rendering for fence failure evidence. */
export function escapeRepoPathForEvidence(path: string): string {
  let result = "";
  for (const char of path) {
    const code = char.charCodeAt(0);
    if (char === "\\") {
      result += "\\\\";
    } else if (char === "\n") {
      result += "\\n";
    } else if (char === "\r") {
      result += "\\r";
    } else if (char === "\t") {
      result += "\\t";
    } else if (code < 0x20 || code === 0x7f) {
      result += `\\x${code.toString(16).padStart(2, "0")}`;
    } else {
      result += char;
    }
  }
  return result;
}

/** Paths a ready-gate repair completion commit would stage (`read-tree` + `add -A`). */
export async function enumerateRepairCompletionCandidates(worktreePath: string): Promise<string[] | undefined> {
  if (!existsSync(join(worktreePath, ".git"))) {
    return [];
  }
  const index = join(tmpdir(), `jarvis-repair-fence-${crypto.randomUUID()}`);
  try {
    const head = (await runRepairFenceGit(worktreePath, ["rev-parse", "HEAD"])).trim();
    await runRepairFenceGit(worktreePath, ["read-tree", head], { GIT_INDEX_FILE: index });
    await runRepairFenceGit(worktreePath, ["add", "-A"], { GIT_INDEX_FILE: index });
    const output = await runRepairFenceGit(worktreePath, ["diff-index", "--name-status", "-z", "HEAD"], {
      GIT_INDEX_FILE: index,
    });
    const parsed = parseGitNameStatusZ(output);
    if (parsed === undefined) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  } finally {
    try {
      rmSync(index, { force: true });
    } catch {
      // best-effort temp index cleanup
    }
  }
}

function findFirstHarnessSidecarBasenameViolation(candidates: readonly string[]): string | undefined {
  const normalizedCandidates: string[] = [];
  for (const raw of candidates) {
    const normalized = validateRepoRelativePath(raw);
    if (normalized === undefined) {
      continue;
    }
    normalizedCandidates.push(normalized);
  }
  normalizedCandidates.sort(compareRepoPathsByUtf8Bytes);
  for (const normalized of normalizedCandidates) {
    if (basename(normalized).startsWith(".jarvis-")) {
      return escapeRepoPathForEvidence(normalized);
    }
  }
  return undefined;
}

export function findFirstRepairFenceViolation(
  candidates: readonly string[],
  allowedPaths: Set<string>,
): string | undefined {
  const normalizedCandidates: string[] = [];
  for (const raw of candidates) {
    const normalized = validateRepoRelativePath(raw);
    if (normalized === undefined) {
      return escapeRepoPathForEvidence(raw);
    }
    normalizedCandidates.push(normalized);
  }
  normalizedCandidates.sort(compareRepoPathsByUtf8Bytes);
  for (const normalized of normalizedCandidates) {
    if (!allowedPaths.has(normalized)) {
      return escapeRepoPathForEvidence(normalized);
    }
  }
  return undefined;
}

export function findFirstMarkdownOnlyFenceViolation(
  candidates: readonly string[],
  markdownOutputRoots: readonly string[],
): string | undefined {
  const normalizedRoots = markdownOutputRoots
    .map((root) => validateRepoRelativePath(root))
    .filter((root): root is string => root !== undefined);
  const normalizedCandidates: string[] = [];
  for (const raw of candidates) {
    const normalized = validateRepoRelativePath(raw);
    if (normalized === undefined) {
      return escapeRepoPathForEvidence(raw);
    }
    normalizedCandidates.push(normalized);
  }
  normalizedCandidates.sort(compareRepoPathsByUtf8Bytes);
  for (const normalized of normalizedCandidates) {
    if (!normalized.endsWith(".md")) {
      return escapeRepoPathForEvidence(normalized);
    }
    const underRoot = normalizedRoots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
    if (!underRoot) {
      return escapeRepoPathForEvidence(normalized);
    }
  }
  return undefined;
}

export async function validateReadyGateRepairCompletion(
  scope: ReadyGateScopeInput,
  allowedPaths: Set<string>,
  markdownOutputRoots?: readonly string[],
  markdownOnlyRequired = false,
): Promise<{ error: Error; offendingPath?: string } | undefined> {
  const candidates = await enumerateRepairCompletionCandidates(scope.worktreePath);
  if (candidates === undefined) {
    return { error: new Error("Ready-gate repair fence could not enumerate completion candidates") };
  }
  const sidecarViolation = findFirstHarnessSidecarBasenameViolation(candidates);
  if (sidecarViolation !== undefined) {
    return {
      offendingPath: sidecarViolation,
      error: new Error(`${REPAIR_FENCE_SIDECAR_FAILURE_MESSAGE}${sidecarViolation}`),
    };
  }
  const violation = findFirstRepairFenceViolation(candidates, allowedPaths);
  if (violation !== undefined) {
    return {
      offendingPath: violation,
      error: new Error(`${REPAIR_FENCE_FAILURE_MESSAGE}${violation}`),
    };
  }
  if (markdownOnlyRequired && (markdownOutputRoots === undefined || markdownOutputRoots.length === 0)) {
    return { error: new Error(REPAIR_FENCE_MISSING_MARKDOWN_PROVENANCE_MESSAGE) };
  }
  if (markdownOutputRoots !== undefined && markdownOutputRoots.length > 0) {
    const markdownViolation = findFirstMarkdownOnlyFenceViolation(candidates, markdownOutputRoots);
    if (markdownViolation !== undefined) {
      return {
        offendingPath: markdownViolation,
        error: new Error(`${REPAIR_FENCE_MARKDOWN_ONLY_FAILURE_MESSAGE}${markdownViolation}`),
      };
    }
  }
  return undefined;
}

function persistReadyGateRepairFence(
  store: StateStore,
  runId: string,
  allowedPaths: Set<string>,
  offendingPath?: string,
  markdownOutputRoots?: readonly string[],
  markdownOnly?: boolean,
): void {
  store.setReadyGateRepairFence(runId, {
    allowedPaths: [...allowedPaths].sort(compareRepoPathsByUtf8Bytes),
    ...(markdownOnly === true ? { markdownOnly: true } : {}),
    ...(markdownOutputRoots !== undefined && markdownOutputRoots.length > 0
      ? { markdownOutputRoots: [...markdownOutputRoots].sort(compareRepoPathsByUtf8Bytes) }
      : {}),
    ...(offendingPath !== undefined ? { offendingPath } : {}),
    outcomeKind: offendingPath !== undefined ? "completion_commit_failed" : "frozen",
  });
}

function readyGateRepairFencePersisted(store: StateStore, runId: string): ReadyGateRepairFenceProvenance | undefined {
  const run = store.loadRun(runId);
  if (run?.readyGateRepairFenceCorrupt === true) {
    return undefined;
  }
  return run?.readyGateRepairFence ?? undefined;
}

/** Enforce a persisted ready-gate repair fence before recovery commit or publish. */
export async function enforcePersistedReadyGateRepairFence(
  scope: ReadyGateScopeInput,
  store: StateStore,
  runId: string,
  options?: { bypass?: boolean },
): Promise<Error | undefined> {
  if (options?.bypass === true) {
    return undefined;
  }
  const run = store.loadRun(runId);
  if (run?.readyGateRepairFenceCorrupt === true) {
    return new Error(REPAIR_FENCE_MISSING_PROVENANCE_MESSAGE);
  }
  const provenance = run?.readyGateRepairFence;
  if (provenance === undefined || provenance === null) {
    return undefined;
  }
  return (
    await validateReadyGateRepairCompletion(
      scope,
      new Set(provenance.allowedPaths),
      provenance.markdownOutputRoots,
      provenance.markdownOnly === true,
    )
  )?.error;
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
          const recoveryFenceError = await enforcePersistedReadyGateRepairFence(
            {
              worktreePath,
              baseRef: args.worktree.baseRef,
              specPath: args.specPath,
            },
            store,
            prepared.result.runId,
            {
              bypass: args.bypassPersistedReadyGateRepairFenceForTest === true,
            },
          );
          if (recoveryFenceError !== undefined) {
            return completionCommitFailed(args, store, prepared.result, recoveryFenceError);
          }
          store.setRunStatus(prepared.result.runId, "in-progress");
          const published = await (args.completionCommitter ?? createCompletionCommitter())({
            worktreePath,
            baseRef: args.worktree.baseRef,
            specPath: args.specPath,
            agent: prepared.result.completionAgent ?? "",
            title: creationTitle,
            forceDistinctCommit: true,
          });
          if (published.commitSha !== undefined) {
            const publication = await publishWithReadyRepair(args, store, prepared.result, 0, {
              worktreePath: getExternalWorktreePath(args.worktree),
              baseRef: args.worktree.baseRef,
              specPath: args.specPath,
              branch: args.worktree.branchName,
              creationTitle,
              ...(args.requiredIntegrationScope ? { requiredIntegrationScope: args.requiredIntegrationScope } : {}),
            });
            if (publication.failure !== undefined) {
              if (args.signal?.aborted) {
                return finishLoop(args, prepared.result.runId, "progress", publication.iterationsConsumed, true);
              }
              appendRuntimeSmokeOutcome(args.logSink, prepared.result.runId, publication.failure.runtimeSmokeOutcome);
              const publishedResult = {
                ...prepared.result,
                iterationsConsumed: publication.iterationsConsumed,
                ...(publication.failure.prNumber !== undefined ? { prNumber: publication.failure.prNumber } : {}),
                ...(publication.failure.prUrl !== undefined ? { prUrl: publication.failure.prUrl } : {}),
              };
              return publication.failure.kind === "completion_commit_failed"
                ? completionCommitFailed(args, store, publishedResult, publication.failure.error)
                : readyFailed(
                    args,
                    store,
                    publishedResult,
                    publication.failure.kind,
                    publication.failure.error,
                    publication.readyGateOrigin,
                  );
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
            appendRuntimeSmokeOutcome(args.logSink, prepared.result.runId, publication.success?.runtimeSmokeOutcome);
          }
          if (published.commitSha === undefined) {
            const uncommitted = await getUncommittedPaths(getExternalWorktreePath(args.worktree));
            if (shouldFailTerminalCompletionForDirtyWorktree(published.commitSha, uncommitted)) {
              return completionCommitFailed(
                args,
                store,
                prepared.result,
                new Error(`Uncommitted changes: ${uncommitted.join(", ")}`),
              );
            }
            store.setRunStatus(prepared.result.runId, "completed");
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
            return { ...prepared.result, runStatus: "completed" };
          }
          return withBoundaryTelemetry(
            args,
            { ...prepared.result, runStatus: "completed" },
            published.commitSha,
            published.filesChanged,
          );
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
    let pendingLandingReprompt = args.landingContractReprompt;

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

      const settled = await awaitIteration(args, runId, attemptId, sessionLog, "bounded", pendingLandingReprompt);
      if (settled.kind === "aborted") {
        closeSessionLog(sessionLog, "abort");
        return finishControlledLoss(
          args,
          store,
          prepared,
          runId,
          worktreePath,
          attemptId,
          iterationsConsumed + 1,
          settled.quiesced,
          "aborted",
        );
      }
      if (settled.kind === "timed_out") {
        closeSessionLog(sessionLog, "timeout");
        return finishControlledLoss(
          args,
          store,
          prepared,
          runId,
          worktreePath,
          attemptId,
          iterationsConsumed + 1,
          settled.quiesced,
          "timed_out",
        );
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

      const { result } = stepResult;

      // Non-progress: abort before terminal boundary when the signal fired mid-step, but the
      // settled result still checkpoints first, same as any other settled iteration.
      if (args.signal?.aborted && result.kind !== "progress") {
        const failure = await checkpointBeforeControlledLoss(
          args,
          prepared,
          store,
          runId,
          worktreePath,
          attemptId,
          iterationsConsumed,
          result,
        );
        return failure ?? finishLoop(args, runId, "progress", iterationsConsumed, true);
      }

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
        try {
          await checkpointSettledIteration(args, prepared, store, runId, worktreePath, attemptId, result);
        } catch (error) {
          return iterationCommitFailed(
            args,
            store,
            runId,
            attemptId,
            iterationsConsumed,
            error instanceof Error ? error : new Error(String(error)),
          );
        }

        store.commitCompletionBoundary({ attemptId, runStatus: "in-progress", outcomeKind: "progress" });
        args.logSink?.append(runId, {
          kind: "boundary_committed",
          attemptId,
          outcomeKind: "progress",
          runStatus: "in-progress",
        });

        if (args.signal?.aborted) {
          return finishLoop(args, runId, "progress", iterationsConsumed, true);
        }

        // Check for graceful pause at the loop boundary
        if (args.pauseSignal?.aborted) {
          store.setRunStatus(runId, "paused");
          return finishLoop(args, runId, "paused", iterationsConsumed, true);
        }

        continue;
      }

      if (result.kind === "complete" && args.promptId === INTENT_SPLIT_PROMPT_ID) {
        const gate = await evaluateIntentSplitLandingGate({
          worktreePath,
          baseRef: args.worktree.baseRef,
          stagingDir: args.expectedArtifactPath,
          durableDir: args.specPath,
        });
        // Mutation checkpoint: skipping the pre-completion landing-validation guard must turn
        // "intent split landing-contract violation reprompts before settle" RED.
        if (!gate.ok) {
          try {
            await checkpointSettledIteration(args, prepared, store, runId, worktreePath, attemptId, result);
          } catch (error) {
            return iterationCommitFailed(
              args,
              store,
              runId,
              attemptId,
              iterationsConsumed,
              error instanceof Error ? error : new Error(String(error)),
            );
          }
          if (!gate.repromptable || iterationsConsumed >= maxIterations) {
            store.commitCompletionBoundary({
              attemptId,
              runStatus: "failed",
              outcomeKind: "landing_failed",
            });
            args.logSink?.append(runId, {
              kind: "boundary_committed",
              attemptId,
              outcomeKind: "landing_failed",
              runStatus: "failed",
            });
            // Mutation checkpoint: inverting this branch to contract_miss or blocked must turn
            // "intent split landing-contract budget exhaustion settles landing_failed" RED.
            store.setRunStatus(runId, "failed");
            args.logSink?.append(runId, {
              kind: "loop_finished",
              loopOutcomeKind: "landing_failed",
              iterationsConsumed,
              resumable: true,
            });
            return {
              kind: "landing_failed",
              runId,
              iterationsConsumed,
              resumable: true,
              attemptId,
              outcomeKind: "landing_failed",
              runStatus: "failed",
            };
          }

          store.commitCompletionBoundary({ attemptId, runStatus: "in-progress", outcomeKind: "progress" });
          args.logSink?.append(runId, {
            kind: "boundary_committed",
            attemptId,
            outcomeKind: "progress",
            runStatus: "in-progress",
          });
          args.logSink?.append(runId, {
            kind: "landing_contract_reprompt",
            attemptId,
            violation: truncateLogText(gate.error),
            offendingFile: gate.offendingFile,
          });
          pendingLandingReprompt = { violation: gate.error, offendingFile: gate.offendingFile };
          if (args.signal?.aborted) {
            return finishLoop(args, runId, "progress", iterationsConsumed, true);
          }
          if (args.pauseSignal?.aborted) {
            store.setRunStatus(runId, "paused");
            return finishLoop(args, runId, "paused", iterationsConsumed, true);
          }
          continue;
        }
        pendingLandingReprompt = undefined;
      }

      if (result.kind === "contract_miss") {
        const reason = result.failureReason ?? result.failedContractId;
        const blockerPath =
          result.failedContractId === "spec.criteria-ticked"
            ? resolveSpecPath(worktreePath, args.expectedArtifactPath)
            : args.promptId === "plan.prompt.draft" && result.failedContractId === "artifact.exists"
              ? resolveSpecPath(worktreePath, join(args.expectedArtifactPath, "intent.md"))
              : resolveSpecPath(worktreePath, args.specPath);
        appendBlockerToSpec(blockerPath, reason);
      }

      // Run coverage advisory for completing implement writes before terminal boundary
      if (result.kind === "complete" && args.promptId === "patch.prompt.body") {
        const advisoryResult = await runCoverageAdvisory(worktreePath, args.bindings, args.signal);
        if (advisoryResult !== null) {
          args.logSink?.append(runId, {
            kind: "coverage_advisory",
            attemptId,
            responseText: truncateLogText(advisoryResult.responseText),
          });
        }
      }

      try {
        await checkpointSettledIteration(args, prepared, store, runId, worktreePath, attemptId, result);
      } catch (error) {
        return iterationCommitFailed(
          args,
          store,
          runId,
          attemptId,
          iterationsConsumed,
          error instanceof Error ? error : new Error(String(error)),
        );
      }

      const terminal = terminalMapping(result);
      const completionAgent =
        result.kind === "complete" ? result.invocation.final?.binding.metadata?.agent?.trim() : undefined;
      const keepsCompletionInProgress =
        terminal.kind === "complete" &&
        args.publishCompletion !== false &&
        (existsSync(join(worktreePath, ".git")) || completionAgent !== undefined);
      const boundaryRunStatus = keepsCompletionInProgress ? ("in-progress" as const) : terminal.runStatus;
      const bindingAttempts = (invocation: InvocationExecution) =>
        invocation.attempts.map((attempt) => ({ bindingId: attempt.binding.id, resultKind: attempt.result.kind }));
      const detail =
        result.kind === "invocation_failure"
          ? { failureKind: result.failureKind, bindingAttempts: bindingAttempts(result.invocation) }
          : result.kind === "stall"
            ? {
                // Reuses the invocation_failure-shaped detail record (not a parallel one) for
                // idle_output_timeout attribution, even though "stall" isn't an InvocationFailureKind
                // routed through INVOCATION_BY_FAILURE_KIND: the persisted/operator-visible shape
                // (bindingAttempts, agent, model, boundMs) is identical, so a consumer switching on
                // failureKind must treat "stall" as its own case, not a stand-in for invocation_failure.
                failureKind: "stall" as const,
                bindingAttempts: bindingAttempts(result.invocation),
                ...(result.boundMs !== undefined ? { boundMs: result.boundMs } : {}),
                ...(result.agent !== undefined ? { agent: result.agent } : {}),
                ...(result.model !== undefined ? { model: result.model } : {}),
              }
            : undefined;
      store.commitCompletionBoundary({
        attemptId,
        runStatus: boundaryRunStatus,
        outcomeKind: terminal.outcomeKind,
        ...(detail !== undefined ? { invocationFailureDetail: detail } : {}),
        ...(completionAgent ? { completionAgent } : {}),
      });
      args.logSink?.append(runId, {
        kind: "boundary_committed",
        attemptId,
        outcomeKind: terminal.outcomeKind,
        runStatus: boundaryRunStatus,
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
      if (result.kind === "contract_miss") {
        // Mutation checkpoint: dropping the `failureReason` spread below must turn
        // "plan-draft normalizer contract_miss carries the normalizer message in the log detail" RED.
        args.logSink?.append(runId, {
          kind: "contract_miss_detail",
          attemptId,
          failedContractId: result.failedContractId,
          responseText: truncateLogText(stepResponseTextForLog(result)),
          ...(result.failureReason !== undefined ? { failureReason: result.failureReason } : {}),
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
        runStatus: boundaryRunStatus,
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
          forceDistinctCommit: true,
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
            if (args.signal?.aborted) {
              return finishLoop(args, runId, "progress", publication.iterationsConsumed, true);
            }
            appendRuntimeSmokeOutcome(args.logSink, runId, publication.failure.runtimeSmokeOutcome);
            const publishedResult = {
              ...attributed,
              iterationsConsumed: publication.iterationsConsumed,
              ...(publication.failure.prNumber !== undefined ? { prNumber: publication.failure.prNumber } : {}),
              ...(publication.failure.prUrl !== undefined ? { prUrl: publication.failure.prUrl } : {}),
            };
            return publication.failure.kind === "completion_commit_failed"
              ? completionCommitFailed(args, store, publishedResult, publication.failure.error)
              : readyFailed(
                  args,
                  store,
                  publishedResult,
                  publication.failure.kind,
                  publication.failure.error,
                  publication.readyGateOrigin,
                );
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
          appendRuntimeSmokeOutcome(args.logSink, runId, publication.success?.runtimeSmokeOutcome);
        }
        if (published.commitSha === undefined) {
          const uncommitted = await getUncommittedPaths(worktreePath);
          if (shouldFailTerminalCompletionForDirtyWorktree(published.commitSha, uncommitted)) {
            return completionCommitFailed(
              args,
              store,
              attributed,
              new Error(`Uncommitted changes: ${uncommitted.join(", ")}`),
            );
          }
          store.setRunStatus(runId, "completed");
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
          return { ...attributed, runStatus: "completed" };
        }
        return withBoundaryTelemetry(
          args,
          { ...attributed, runStatus: "completed" },
          published.commitSha,
          published.filesChanged,
        );
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

type RaceOutcome =
  | { kind: "settled"; result: Awaited<ReturnType<typeof executeWrite>> }
  | { kind: "threw"; error: unknown }
  | { kind: "timed_out" }
  | { kind: "aborted" };

/** What the raced-away invocation actually produced once it quiesced (or failed to). */
export type QuiescedExecutionOutcome = Extract<RaceOutcome, { kind: "settled" } | { kind: "threw" }>;

type IterationSettlement =
  | Extract<RaceOutcome, { kind: "settled" } | { kind: "threw" }>
  | { kind: "timed_out"; quiesced: QuiescedExecutionOutcome }
  | { kind: "aborted"; quiesced: QuiescedExecutionOutcome };

export type AbortWatchdogRole = "abort" | "watchdog";
type IterationSettlementPolicy = "bounded" | "finalization-repair";

/** Pure precedence predicate: which settlement kind a given race role produces. */
function resolveIterationSettlementKind(role: AbortWatchdogRole): "aborted" | "timed_out" {
  return role === "abort" ? "aborted" : "timed_out";
}

function isInterruptedRace(raced: RaceOutcome): raced is { kind: "aborted" | "timed_out" } {
  return raced.kind === "aborted" || raced.kind === "timed_out";
}

async function settleFinalizationRepair(
  raced: RaceOutcome,
  execution: Promise<QuiescedExecutionOutcome>,
  abortExecution: () => void,
): Promise<IterationSettlement> {
  abortExecution();
  const quiesced = await execution;
  return isInterruptedRace(raced) ? { kind: raced.kind, quiesced } : quiesced;
}

async function settleBoundedIteration(
  raced: RaceOutcome,
  execution: Promise<QuiescedExecutionOutcome>,
  schedule: WallSegmentSchedule,
  quiescenceTimeoutMs: number,
): Promise<IterationSettlement> {
  if (!isInterruptedRace(raced)) return raced;
  const quiesced = await boundQuiescenceWait(execution, schedule, quiescenceTimeoutMs);
  return { kind: raced.kind, quiesced };
}

/**
 * Starts after `iteration_started`, so pre-spawn stalls are fenced too. On an abort/watchdog win,
 * this does not return until the raced-away `execution` promise itself quiesces (settles or
 * throws), so the caller always has the last-started invocation's actual outcome to checkpoint
 * before it declares the iteration lost.
 */
async function awaitIteration(
  args: WriteLoopInput,
  runId: string,
  attemptId: string,
  sessionLog: SessionLog,
  settlementPolicy: IterationSettlementPolicy = "bounded",
  landingContractReprompt?: { violation: string; offendingFile: string },
): Promise<IterationSettlement> {
  const executionController = new AbortController();
  const abortExecution = () => executionController.abort();
  if (args.signal?.aborted) abortExecution();
  args.signal?.addEventListener("abort", abortExecution, { once: true });

  const schedule = args.schedule ?? defaultWallSegmentSchedule;
  const wallSegmentMs = args.iterationTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS;
  let wallSchedule: WallSegmentScheduleHandle | undefined;
  let ceilingTimeout: ReturnType<typeof setTimeout> | undefined;
  let watchdogSettled = false;
  let resolveWatchdog!: (value: RaceOutcome) => void;

  const fireWatchdogTimeout = () => {
    if (watchdogSettled) return;
    watchdogSettled = true;
    abortExecution();
    resolveWatchdog({ kind: resolveIterationSettlementKind("watchdog") });
  };

  const bumpWallSegment = () => {
    if (watchdogSettled) return;
    wallSchedule?.cancel();
    wallSchedule = schedule(fireWatchdogTimeout, wallSegmentMs);
  };

  const onInvocationOutputProgress = args.resetIterationWallOnOutput === false ? undefined : bumpWallSegment;

  const watchdog = new Promise<RaceOutcome>((resolve) => {
    resolveWatchdog = resolve;
    bumpWallSegment();
    if (args.iterationCeilingMs !== undefined) {
      ceilingTimeout = setTimeout(fireWatchdogTimeout, args.iterationCeilingMs);
    }
  });

  const execution: Promise<QuiescedExecutionOutcome> = executeWrite({
    ...buildWriteExecuteInput(args, runId, attemptId, executionController.signal, sessionLog, landingContractReprompt),
    ...(onInvocationOutputProgress !== undefined ? { onInvocationOutputProgress } : {}),
  }).then(
    (result): QuiescedExecutionOutcome => ({ kind: "settled", result }),
    (error): QuiescedExecutionOutcome => ({ kind: "threw", error }),
  );
  let removeAbort: (() => void) | undefined;
  const abort = new Promise<RaceOutcome>((resolve) => {
    if (!args.signal) return;
    const resolveAbort = () => queueMicrotask(() => resolve({ kind: resolveIterationSettlementKind("abort") }));
    if (args.signal.aborted) return resolveAbort();
    const onAbort = () => resolveAbort();
    args.signal.addEventListener("abort", onAbort, { once: true });
    removeAbort = () => args.signal?.removeEventListener("abort", onAbort);
  });

  const raced = await Promise.race([execution, watchdog, abort]);
  watchdogSettled = true;
  wallSchedule?.cancel();
  if (ceilingTimeout !== undefined) clearTimeout(ceilingTimeout);
  args.signal?.removeEventListener("abort", abortExecution);
  removeAbort?.();

  if (settlementPolicy === "finalization-repair") {
    return settleFinalizationRepair(raced, execution, abortExecution);
  }
  return settleBoundedIteration(raced, execution, schedule, args.quiescenceTimeoutMs ?? DEFAULT_QUIESCENCE_TIMEOUT_MS);
}

/**
 * Waits for a raced-away invocation to quiesce, but not forever: an invocation that ignores its
 * `AbortSignal` never settles on its own, so past `boundMs` this synthesizes a "threw" outcome —
 * nothing to checkpoint — letting the caller fall through to the un-checkpointed loss exactly as
 * it would for an invocation that quiesced by throwing.
 */
function boundQuiescenceWait(
  execution: Promise<QuiescedExecutionOutcome>,
  schedule: WallSegmentSchedule,
  boundMs: number,
): Promise<QuiescedExecutionOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const handle = schedule(() => {
      if (settled) return;
      settled = true;
      resolve({ kind: "threw", error: new Error(`invocation did not quiesce within ${boundMs}ms`) });
    }, boundMs);
    execution.then((outcome) => {
      if (settled) return;
      settled = true;
      handle.cancel();
      resolve(outcome);
    });
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

/**
 * Checkpoints a settled result before a controlled loss (abort/kill mid-step, or a watchdog/abort
 * race) is declared final, same committer seam as any other settled iteration. A checkpoint
 * failure after a kill already persisted (`commitGuardedKill`) must not overwrite the killed
 * status — checked here ahead of any race-kind distinction, since a watchdog can also fire after
 * a kill has landed. That case is logged for resume diagnostics and returns the ordinary
 * resumable loss result without writing a boundary or starting publication. Any other checkpoint
 * failure resumes like any other `iteration_commit_failed`. Returns `undefined` on a successful
 * checkpoint (or nothing to checkpoint), leaving the loss outcome to the caller.
 */
async function checkpointBeforeControlledLoss(
  args: WriteLoopInput,
  prepared: { creationTitle?: string },
  store: StateStore,
  runId: string,
  worktreePath: string,
  attemptId: string,
  iterationsConsumed: number,
  result: StepRunResult,
): Promise<WriteLoopResult | undefined> {
  try {
    await checkpointSettledIteration(args, prepared, store, runId, worktreePath, attemptId, result);
    return undefined;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (store.loadRun(runId)?.status === "killed") {
      args.logSink?.append(runId, {
        kind: "run_execution_failed",
        message: `checkpoint after kill failed: ${err.message}`,
      });
      return finishLoop(args, runId, "progress", iterationsConsumed, true);
    }
    return iterationCommitFailed(args, store, runId, attemptId, iterationsConsumed, err);
  }
}

/**
 * Handles a controlled loss (abort/kill or watchdog) once the raced-away invocation has quiesced.
 * When it settled with a real step result, that result is checkpointed before the loss is declared
 * final, same as any other settled iteration.
 */
async function finishControlledLoss(
  args: WriteLoopInput,
  store: StateStore,
  prepared: { creationTitle?: string },
  runId: string,
  worktreePath: string,
  attemptId: string,
  iterationsConsumed: number,
  quiesced: QuiescedExecutionOutcome,
  race: "aborted" | "timed_out",
): Promise<WriteLoopResult> {
  if (quiesced.kind !== "settled") {
    return race === "aborted"
      ? finishLoop(args, runId, "progress", iterationsConsumed, true)
      : finishIterationTimeout(args, store, runId, attemptId, iterationsConsumed);
  }

  const failure = await checkpointBeforeControlledLoss(
    args,
    prepared,
    store,
    runId,
    worktreePath,
    attemptId,
    iterationsConsumed,
    quiesced.result.result,
  );
  if (failure !== undefined) return failure;

  return race === "aborted"
    ? finishLoop(args, runId, "progress", iterationsConsumed, true)
    : finishIterationTimeout(args, store, runId, attemptId, iterationsConsumed);
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
    stepId: args.stepId ?? null,
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
  landingContractReprompt?: { violation: string; offendingFile: string },
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
    ...(args.idleOutputMs !== undefined ? { idleOutputMs: args.idleOutputMs } : {}),
    ...(args.joinProcessOnIdleStall === true ? { joinProcessOnIdleStall: true } : {}),
    ...(landingContractReprompt !== undefined ? { landingContractReprompt } : {}),
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
  if (result.kind === "stall") {
    return { kind: "idle_output_timeout", runStatus: "failed", outcomeKind: "idle_output_timeout" };
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
    if (outcomeKind === "landing_failed") {
      return null;
    }
    const detail = run.attempts[run.attempts.length - 1]?.invocationFailureDetail ?? undefined;
    return {
      kind:
        outcomeKind === "iteration_timeout" || outcomeKind === "idle_output_timeout"
          ? outcomeKind
          : "invocation_failure",
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

export type CompletionPublicationSeams = Pick<
  WriteLoopInput,
  "completionPublisher" | "readyFinalizer" | "skipReadyFinalization"
>;

export type CompletionPublishFailure = {
  kind:
    | "completion_commit_failed"
    | "ready_gate_failed"
    | "ready_gate_out_of_scope"
    | "ready_flip_failed"
    | "surviving_mutation_failed"
    | "runtime_smoke_failed";
  error?: Error;
  prNumber?: number;
  prUrl?: string;
  runtimeSmokeOutcome?: SmokePass;
};

export type CompletionPublishSuccess = {
  prNumber?: number;
  prUrl?: string;
  runtimeSmokeOutcome: SmokePass | undefined;
};

export function appendRuntimeSmokeOutcome(
  logSink: LogSink | undefined,
  runId: string,
  outcome: SmokePass | undefined,
): void {
  if (outcome !== undefined) {
    if (outcome.kind === "not-runnable" && outcome.discoveryReason.trim() === "") {
      throw new Error("Runtime smoke discovery reason must be non-empty");
    }
    logSink?.append(
      runId,
      outcome.kind === "observed-clean"
        ? { kind: "runtime_smoke_outcome", outcome: "observed-clean" }
        : {
            kind: "runtime_smoke_outcome",
            outcome: "not-runnable",
            inspectedPaths: outcome.inspectedPaths,
            discoveryReason: outcome.discoveryReason,
          },
    );
  }
}

type CompletionPublishInput = Parameters<typeof publishCompletionArtifacts>[1];
type CompletionPublishOutcome = CompletionPublishFailure | (CompletionPublishSuccess & { kind: "success" });

/** `unsettled` consumed no iteration; `blocked` and `continue` each consumed one. */
export type RepairIterationOutcome = "unsettled" | "blocked" | "continue";

/** One repair iteration: reprompt the agent with the gate failure, then record its boundary. */
async function runReadyRepairIteration(
  args: WriteLoopInput,
  store: StateStore,
  result: WriteLoopResult,
  gateError: ReadyGateError,
  iterationNumber: number,
): Promise<RepairIterationOutcome> {
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
    joinProcessOnIdleStall: true,
    promptPlaceholders: {
      GATE_COMMAND: gateError.command,
      GATE_EXIT_CODE: String(gateError.exitCode ?? "unknown"),
      GATE_OUTPUT: gateError.output.slice(-READY_GATE_OUTPUT_MAX_CHARS),
    },
  };
  const settled = await awaitIteration(repairArgs, result.runId, attemptId, sessionLog, "finalization-repair");
  if (settled.kind !== "settled") {
    closeSessionLog(
      sessionLog,
      settled.kind === "timed_out" ? "timeout" : settled.kind === "aborted" ? "abort" : "error",
    );
    return "unsettled";
  }
  closeSessionLog(sessionLog, "completed");

  const stepResult = settled.result.result;
  const boundary =
    stepResult.kind === "blocked"
      ? terminalMapping(stepResult)
      : { runStatus: "in-progress" as const, outcomeKind: "progress" as const };
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

/** One bounded repair iteration for a mutation that survived finalization. */
export async function runMutationRepairIteration(
  args: WriteLoopInput,
  store: StateStore,
  result: WriteLoopResult,
  mutationError: SurvivingMutationError,
  iterationNumber: number,
): Promise<RepairIterationOutcome> {
  const attemptId = store.recordAttemptStart(result.runId);
  args.logSink?.append(result.runId, { kind: "iteration_started", attemptId });
  const clock = args.clock ?? (() => new Date());
  const sessionLog = openSessionLog(result.runId, formatSessionLogTimestamp(clock()), {
    ...(args.sessionsDir !== undefined ? { sessionsDir: args.sessionsDir } : {}),
    clock,
  });
  sessionLog.append("harness", `run=${result.runId} spec=${args.specPath} mutation-repair=${iterationNumber}`);

  const repairArgs: WriteLoopInput = {
    ...args,
    promptId: "write.mutation-repair",
    joinProcessOnIdleStall: true,
    promptPlaceholders: {
      SURVIVING_MUTATION: mutationError.mutation,
      SOURCE_FILE: mutationError.sourceSiteFile,
      SOURCE_LINE: String(mutationError.sourceSiteLine),
      DUAL_CONSTRAINT_DETAIL: mutationError.dualConstraint
        ? "The source is a timer callback in a determinism-guarded suite. Extract and test a pure predicate in both directions without a real-timer wait."
        : "",
    },
  };
  const settled = await awaitIteration(repairArgs, result.runId, attemptId, sessionLog, "finalization-repair");
  if (settled.kind !== "settled") {
    closeSessionLog(
      sessionLog,
      settled.kind === "timed_out" ? "timeout" : settled.kind === "aborted" ? "abort" : "error",
    );
    return "unsettled";
  }
  closeSessionLog(sessionLog, "completed");

  const stepResult = settled.result.result;
  const boundary =
    stepResult.kind === "blocked"
      ? terminalMapping(stepResult)
      : { runStatus: "in-progress" as const, outcomeKind: "progress" as const };
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

async function classifyReadyGatePublishFailure(
  failure: CompletionPublishFailure,
  input: CompletionPublishInput,
): Promise<CompletionPublishFailure> {
  if (failure.kind !== "ready_gate_failed" || !(failure.error instanceof ReadyGateError)) {
    return failure;
  }
  const classified = await classifyReadyGateError(failure.error, {
    worktreePath: input.worktreePath,
    baseRef: input.baseRef,
    specPath: input.specPath,
  });
  return {
    ...failure,
    kind: classified.gateFailureKind === "ready_gate_out_of_scope" ? "ready_gate_out_of_scope" : "ready_gate_failed",
    error: classified,
  };
}

type ReadyRepairPublishResult = {
  failure?: CompletionPublishFailure;
  success?: CompletionPublishSuccess;
  iterationsConsumed: number;
  readyGateOrigin?: ReadyGateOrigin;
};

function readyGateRepairMarkdownProvenanceFailure(iterationsConsumed: number): ReadyRepairPublishResult {
  return {
    failure: {
      kind: "completion_commit_failed",
      error: new Error(REPAIR_FENCE_MISSING_MARKDOWN_PROVENANCE_MESSAGE),
    },
    iterationsConsumed,
  };
}

function readyGateRepairProvenanceFailure(iterationsConsumed: number): ReadyRepairPublishResult {
  return {
    failure: {
      kind: "completion_commit_failed",
      error: new Error(REPAIR_FENCE_MISSING_PROVENANCE_MESSAGE),
    },
    iterationsConsumed,
  };
}

function loadPersistedRepairAllowset(store: StateStore, runId: string): Set<string> | undefined | "corrupt" {
  const persistedRun = store.loadRun(runId);
  if (persistedRun?.readyGateRepairFenceCorrupt === true) {
    return "corrupt";
  }
  const persistedFence = persistedRun?.readyGateRepairFence;
  if (persistedFence === undefined || persistedFence === null) {
    return undefined;
  }
  return new Set(persistedFence.allowedPaths);
}

function isActiveReadyGateFailure(
  outcome: CompletionPublishOutcome,
): outcome is CompletionPublishFailure & { kind: "ready_gate_failed"; error: ReadyGateError } {
  return outcome.kind === "ready_gate_failed" && outcome.error instanceof ReadyGateError && !outcome.error.timedOut;
}

async function initializeFrozenRepairAllowset(
  store: StateStore,
  runId: string,
  input: CompletionPublishInput,
  loopArgs: WriteLoopInput,
  iterationsConsumed: number,
): Promise<{ allowset: Set<string> } | { failure: ReadyRepairPublishResult }> {
  if (!(await shouldEnforceReadyGateRepairFence(input.worktreePath))) {
    return { allowset: new Set() };
  }
  const derived = await deriveGateAllowedPaths(
    {
      worktreePath: input.worktreePath,
      baseRef: input.baseRef,
      specPath: input.specPath,
    },
    REPAIR_FENCE_ALLOWSET_SEAMS,
  );
  if (derived === undefined) {
    return {
      failure: {
        failure: {
          kind: "completion_commit_failed",
          error: new Error("Ready-gate repair fence could not derive allowed paths"),
        },
        iterationsConsumed,
      },
    };
  }
  const markdownOnly = resolveMarkdownOnlyWorkflowPromptId(loopArgs.promptId, loopArgs.landing) !== undefined;
  const markdownOutputRoots = deriveMarkdownOutputRoots({
    promptId: loopArgs.promptId,
    specPath: loopArgs.specPath,
    expectedArtifactPath: loopArgs.expectedArtifactPath,
    ...(loopArgs.landing !== undefined ? { landing: loopArgs.landing } : {}),
  });
  if (markdownOnly && (markdownOutputRoots === undefined || markdownOutputRoots.length === 0)) {
    return { failure: readyGateRepairMarkdownProvenanceFailure(iterationsConsumed) };
  }
  persistReadyGateRepairFence(store, runId, derived, undefined, markdownOutputRoots, markdownOnly);
  const persistedFence = readyGateRepairFencePersisted(store, runId);
  if (persistedFence === undefined) {
    return { failure: readyGateRepairProvenanceFailure(iterationsConsumed) };
  }
  if (
    markdownOnly &&
    (persistedFence.markdownOutputRoots === undefined || persistedFence.markdownOutputRoots.length === 0)
  ) {
    return { failure: readyGateRepairMarkdownProvenanceFailure(iterationsConsumed) };
  }
  return { allowset: derived };
}

async function enforceRepairIterationFence(
  _args: WriteLoopInput,
  store: StateStore,
  runId: string,
  input: CompletionPublishInput,
  frozenRepairAllowset: Set<string>,
  iterationsConsumed: number,
): Promise<ReadyRepairPublishResult | undefined> {
  if (!(await shouldEnforceReadyGateRepairFence(input.worktreePath))) {
    return undefined;
  }
  const persistedFence = store.loadRun(runId)?.readyGateRepairFence;
  const markdownOutputRoots = persistedFence?.markdownOutputRoots;
  const markdownOnlyRequired =
    persistedFence?.markdownOnly === true ||
    resolveMarkdownOnlyWorkflowPromptId(_args.promptId, _args.landing) !== undefined;
  const fenceResult = await validateReadyGateRepairCompletion(
    {
      worktreePath: input.worktreePath,
      baseRef: input.baseRef,
      specPath: input.specPath,
    },
    frozenRepairAllowset,
    markdownOutputRoots,
    markdownOnlyRequired,
  );
  if (fenceResult === undefined) {
    return undefined;
  }
  persistReadyGateRepairFence(
    store,
    runId,
    frozenRepairAllowset,
    fenceResult.offendingPath,
    markdownOutputRoots,
    markdownOnlyRequired ? true : undefined,
  );
  return {
    failure: { kind: "completion_commit_failed", error: fenceResult.error },
    iterationsConsumed,
  };
}

async function commitRepairAndRepublish(
  args: WriteLoopInput,
  input: CompletionPublishInput,
  result: WriteLoopResult,
  iterationsConsumed: number,
): Promise<
  { kind: "success"; outcome: CompletionPublishOutcome } | { kind: "failure"; result: ReadyRepairPublishResult }
> {
  try {
    await (args.completionCommitter ?? createCompletionCommitter())({
      worktreePath: input.worktreePath,
      baseRef: input.baseRef,
      specPath: input.specPath,
      agent: result.completionAgent ?? "",
      title: resolvePublicationTitle(input.worktreePath, input.specPath, input.creationTitle),
      forceDistinctCommit: true,
    });
    let outcome = await publishCompletionArtifacts(args, input);
    if (outcome.kind !== "success") {
      outcome = await classifyReadyGatePublishFailure(outcome, input);
    }
    return { kind: "success", outcome };
  } catch (error) {
    return {
      kind: "failure",
      result: {
        failure: {
          kind: "completion_commit_failed",
          error: error instanceof Error ? error : new Error(String(error)),
        },
        iterationsConsumed,
      },
    };
  }
}

type ReadyGateRepairLoopResult =
  | { kind: "done"; outcome: CompletionPublishOutcome; iterationsConsumed: number; repairBudgetExhausted: boolean }
  | { kind: "early"; result: ReadyRepairPublishResult };

async function runReadyGateRepairLoop(
  args: WriteLoopInput,
  store: StateStore,
  result: WriteLoopResult,
  input: CompletionPublishInput,
  outcome: CompletionPublishOutcome,
  iterationsConsumed: number,
  frozenRepairAllowset: Set<string> | undefined,
): Promise<ReadyGateRepairLoopResult> {
  let currentOutcome = outcome;
  let currentIterations = iterationsConsumed;
  let allowset = frozenRepairAllowset;
  let repairAttempt = 0;
  let repairBudgetExhausted = false;

  while (isActiveReadyGateFailure(currentOutcome)) {
    repairAttempt += 1;
    if (repairAttempt > MAX_READY_GATE_REPAIRS) {
      repairBudgetExhausted = true;
      break;
    }
    if (currentIterations >= (args.maxIterations ?? DEFAULT_MAX_ITERATIONS)) break;
    if (allowset === undefined) {
      const initialized = await initializeFrozenRepairAllowset(store, result.runId, input, args, currentIterations);
      if ("failure" in initialized) return { kind: "early", result: initialized.failure };
      allowset = initialized.allowset;
    }
    args.logSink?.append(result.runId, {
      kind: "ready_gate_repair",
      attempt: repairAttempt,
      gateExitCode: currentOutcome.error.exitCode,
    });

    const repairOutcome = await runReadyRepairIteration(
      args,
      store,
      result,
      currentOutcome.error,
      currentIterations + 1,
    );
    if (repairOutcome === "unsettled") {
      return { kind: "early", result: { failure: currentOutcome, iterationsConsumed: currentIterations } };
    }
    currentIterations += 1;
    if (repairOutcome === "blocked") {
      return { kind: "early", result: { failure: currentOutcome, iterationsConsumed: currentIterations } };
    }

    const fenceFailure = await enforceRepairIterationFence(
      args,
      store,
      result.runId,
      input,
      allowset,
      currentIterations,
    );
    if (fenceFailure !== undefined) return { kind: "early", result: fenceFailure };

    const republish = await commitRepairAndRepublish(args, input, result, currentIterations);
    if (republish.kind === "failure") return { kind: "early", result: republish.result };
    currentOutcome = republish.outcome;
  }

  return {
    kind: "done",
    outcome: currentOutcome,
    iterationsConsumed: currentIterations,
    repairBudgetExhausted,
  };
}

function appendReadyGateTimeoutLog(args: WriteLoopInput, runId: string, outcome: CompletionPublishOutcome): void {
  if (outcome.kind === "ready_gate_failed" && outcome.error instanceof ReadyGateError && outcome.error.timedOut) {
    args.logSink?.append(runId, {
      kind: "ready_gate_timeout",
      gateExitCode: outcome.error.exitCode,
    });
  }
}

function resolveExhaustedReadyGateOrigin(
  store: StateStore,
  runId: string,
  result: WriteLoopResult,
  outcome: CompletionPublishOutcome,
  repairBudgetExhausted: boolean,
): ReadyGateOrigin | undefined {
  if (!repairBudgetExhausted || !isActiveReadyGateFailure(outcome)) return undefined;
  const checkpointResult: WriteLoopResult = {
    ...result,
    ...(outcome.prNumber !== undefined ? { prNumber: outcome.prNumber } : {}),
    ...(outcome.prUrl !== undefined ? { prUrl: outcome.prUrl } : {}),
  };
  return persistRetainedFinalizationCheckpoint(store, runId, checkpointResult) ? "repair_budget_exhausted" : undefined;
}

function buildReadyRepairPublishResult(
  outcome: CompletionPublishOutcome,
  iterationsConsumed: number,
  readyGateOrigin?: ReadyGateOrigin,
): ReadyRepairPublishResult {
  return outcome.kind === "success"
    ? { success: outcome, iterationsConsumed }
    : { failure: outcome, iterationsConsumed, ...(readyGateOrigin !== undefined ? { readyGateOrigin } : {}) };
}

export async function publishWithReadyRepair(
  args: WriteLoopInput,
  store: StateStore,
  result: WriteLoopResult,
  iterationsConsumed: number,
  input: CompletionPublishInput,
): Promise<ReadyRepairPublishResult> {
  let outcome = await publishCompletionArtifacts(args, input);
  if (outcome.kind !== "success") {
    outcome = await classifyReadyGatePublishFailure(outcome, input);
  }
  const frozenRepairAllowset = loadPersistedRepairAllowset(store, result.runId);
  if (frozenRepairAllowset === "corrupt") {
    return readyGateRepairProvenanceFailure(iterationsConsumed);
  }
  const loopResult = await runReadyGateRepairLoop(
    args,
    store,
    result,
    input,
    outcome,
    iterationsConsumed,
    frozenRepairAllowset,
  );
  if (loopResult.kind === "early") return loopResult.result;
  appendReadyGateTimeoutLog(args, result.runId, loopResult.outcome);
  const readyGateOrigin = resolveExhaustedReadyGateOrigin(
    store,
    result.runId,
    result,
    loopResult.outcome,
    loopResult.repairBudgetExhausted,
  );
  return buildReadyRepairPublishResult(loopResult.outcome, loopResult.iterationsConsumed, readyGateOrigin);
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
): Promise<SmokePass | undefined> {
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
            verificationResult.dualConstraint,
          );
        }
      },
      runRuntimeSmokeVerification: async (worktreePath: string, baseRef: string) => {
        const verificationResult = await verifyRuntimeSmoke({
          worktreePath,
          runBase: baseRef,
        });
        return verificationResult;
      },
    });
  const finalInput = {
    worktreePath: input.worktreePath,
    branch: input.branch,
    baseRef: input.baseRef,
    ...(input.requiredIntegrationScope ? { requiredIntegrationScope: input.requiredIntegrationScope } : {}),
  };
  return (await readyFinalizer(finalInput))?.runtimeSmokeOutcome;
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
  if (err instanceof ReadyFlipError) {
    return {
      kind: "ready_flip_failed",
      error: err,
      runtimeSmokeOutcome: err.runtimeSmokeOutcome,
      ...(prNumber !== undefined ? { prNumber } : {}),
      ...(prUrl !== undefined ? { prUrl } : {}),
    };
  }
  return {
    kind:
      err instanceof ReadyGateError
        ? err.gateFailureKind === "ready_gate_out_of_scope"
          ? "ready_gate_out_of_scope"
          : "ready_gate_failed"
        : "ready_flip_failed",
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
  let runtimeSmokeOutcome: SmokePass | undefined;
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
    if (!seams.skipReadyFinalization) {
      runtimeSmokeOutcome = await runReadyFinalizer(seams, {
        worktreePath: input.worktreePath,
        baseRef: input.baseRef,
        branch: input.branch,
        ...(input.requiredIntegrationScope ? { requiredIntegrationScope: input.requiredIntegrationScope } : {}),
      });
    }
  } catch (finalizeError) {
    const err = finalizeError instanceof Error ? finalizeError : new Error(String(finalizeError));
    return buildFinalizationErrorResponse(err, publisherResult?.prNumber, publisherResult?.prUrl);
  }
  return {
    kind: "success",
    ...(publisherResult?.prNumber !== undefined ? { prNumber: publisherResult.prNumber } : {}),
    ...(publisherResult?.prUrl !== undefined ? { prUrl: publisherResult.prUrl } : {}),
    runtimeSmokeOutcome,
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

export function persistRetainedFinalizationCheckpoint(
  store: StateStore,
  runId: string,
  result: WriteLoopResult,
): boolean {
  const run = store.loadRun(runId);
  if (!run) return false;
  const doneAttempt = [...run.attempts].reverse().find((attempt) => attempt.outcomeKind === "done");
  const completionAgent = doneAttempt?.completionAgent ?? result.completionAgent;
  if (doneAttempt === undefined || completionAgent === undefined || completionAgent.length === 0) return false;
  store.setRetainedFinalizationCheckpoint(runId, {
    completionAttemptId: doneAttempt.id,
    completionAgent,
    ...(run.prNumber != null ? { prNumber: run.prNumber } : {}),
    ...(run.prUrl != null ? { prUrl: run.prUrl } : {}),
    ...(result.prNumber !== undefined ? { prNumber: result.prNumber } : {}),
    ...(result.prUrl !== undefined ? { prUrl: result.prUrl } : {}),
  });
  return true;
}

function readyFailed(
  args: WriteLoopInput,
  store: StateStore,
  result: WriteLoopResult,
  kind:
    | "ready_gate_failed"
    | "ready_gate_out_of_scope"
    | "ready_flip_failed"
    | "surviving_mutation_failed"
    | "runtime_smoke_failed",
  error?: Error,
  readyGateOrigin?: ReadyGateOrigin,
): WriteLoopResult {
  const publicationFailure = error === undefined ? undefined : publicationFailureFor(error);
  const resumable =
    kind === "ready_gate_failed" || kind === "ready_gate_out_of_scope" || kind === "surviving_mutation_failed";
  const mutationFields = survivingMutationLogFields(error);
  const outOfScopeFields = readyGateOutOfScopeLogFields(error);
  // Publication marks the row `in-progress` for the finalization tail, so every exit from that
  // tail must restore a terminal status. Gate and mutation failures demote to `failed`; flip and
  // smoke failures keep their documented `completed` status. Leaving `in-progress` strands the row
  // non-live forever and hangs `run wait`, which follows the log for non-terminal rows.
  store.setRunStatus(
    result.runId,
    kind === "surviving_mutation_failed" || kind === "ready_gate_failed" || kind === "ready_gate_out_of_scope"
      ? "failed"
      : "completed",
  );
  args.logSink?.append(result.runId, {
    kind: "loop_finished",
    loopOutcomeKind: kind,
    iterationsConsumed: result.iterationsConsumed,
    resumable,
    ...mutationFields,
    ...outOfScopeFields,
    ...exhaustedRedTerminalLogFields(readyGateOrigin),
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
    ...(kind === "ready_gate_out_of_scope"
      ? {
          readyGateError: outOfScopeFields.readyGateOutOfScopeDetail ?? error?.message ?? "ready gate failed",
          ...outOfScopeFields,
        }
      : kind === "ready_gate_failed"
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

export type ProgressIterationCommitOutcome =
  | { kind: "committed"; commitSha: string }
  | { kind: "skipped"; skipReason: "no_git" | "no_file_changes" | "no_binding" };

async function commitSettledIteration(
  args: WriteLoopInput,
  prepared: { creationTitle?: string },
  store: StateStore,
  runId: string,
  worktreePath: string,
  result: StepRunResult,
): Promise<ProgressIterationCommitOutcome> {
  if (!existsSync(join(worktreePath, ".git"))) {
    return { kind: "skipped", skipReason: "no_git" };
  }
  // No binding ever attributed (e.g. `invocation_failure`/`no_binding`): nothing was invoked and
  // nothing to checkpoint, so skip rather than fail the run over missing attribution.
  if (result.invocation.final === null) {
    return { kind: "skipped", skipReason: "no_binding" };
  }
  const agent = result.invocation.final?.binding.metadata?.agent?.trim();
  if (!agent) throw new Error("completion attribution is missing");
  const artifactPath = resolveSpecPath(worktreePath, args.expectedArtifactPath);
  const specPath = existsSync(artifactPath) ? artifactPath : args.specPath;
  const metadata = result.invocation.final?.binding.metadata as { title?: string } | undefined;
  const stepTitle = typeof metadata?.title === "string" ? metadata.title.trim() : "";
  const title = stepTitle
    ? stepTitle
    : resolveAndPersistCreationTitle(store, runId, worktreePath, args.specPath, prepared.creationTitle);
  const headBefore = await getCurrentHeadAsync(worktreePath);
  const committed = await (args.completionCommitter ?? createCompletionCommitter())({
    worktreePath,
    baseRef: args.worktree.baseRef,
    specPath,
    agent,
    title,
  });
  if (committed.commitSha === undefined || committed.commitSha === headBefore) {
    return { kind: "skipped", skipReason: "no_file_changes" };
  }
  return { kind: "committed", commitSha: committed.commitSha };
}

/** Commits the settled result's checkpoint and appends its `iteration_commit` log event. */
async function checkpointSettledIteration(
  args: WriteLoopInput,
  prepared: { creationTitle?: string },
  store: StateStore,
  runId: string,
  worktreePath: string,
  attemptId: string,
  result: StepRunResult,
): Promise<ProgressIterationCommitOutcome> {
  const commitOutcome = await commitSettledIteration(args, prepared, store, runId, worktreePath, result);
  args.logSink?.append(runId, {
    kind: "iteration_commit",
    attemptId,
    ...(commitOutcome.kind === "committed"
      ? { commitSha: commitOutcome.commitSha }
      : { skipReason: commitOutcome.skipReason }),
  });
  return commitOutcome;
}

function iterationCommitFailed(
  args: WriteLoopInput,
  store: StateStore,
  runId: string,
  attemptId: string,
  iterationsConsumed: number,
  error: Error,
): WriteLoopResult {
  store.setRunStatus(runId, "failed");
  const publicationFailure = publicationFailureFor(error);
  args.logSink?.append(runId, {
    kind: "loop_finished",
    loopOutcomeKind: "iteration_commit_failed",
    iterationsConsumed,
    resumable: true,
    ...(publicationFailure !== undefined ? { publicationFailure } : {}),
  });
  return {
    kind: "iteration_commit_failed",
    runId,
    iterationsConsumed,
    resumable: true,
    completionCommitError: error.message,
    attemptId,
    outcomeKind: "progress",
    runStatus: "failed",
    ...(publicationFailure !== undefined ? { publicationFailure } : {}),
  };
}

function appendBlockerToSpec(specPath: string, reason: string): void {
  appendFileSync(specPath, `\n## Blocker\n\nArtifact contract check failed: ${reason}\n`, "utf8");
}

export function exhaustedRedTerminalLogFields(
  readyGateOrigin?: ReadyGateOrigin,
): Pick<LoopFinishedEvent, "readyGateOrigin" | "readyGateRepairCount"> {
  return readyGateOrigin === "repair_budget_exhausted"
    ? { readyGateOrigin, readyGateRepairCount: MAX_READY_GATE_REPAIRS }
    : {};
}

/** Terminal `loop_finished` evidence for repair-budget exhaustion after the configured repair cap. */
export function isExhaustedRedTerminalEvidence(
  event:
    | Pick<LoopFinishedEvent, "loopOutcomeKind" | "resumable" | "readyGateOrigin" | "readyGateRepairCount">
    | undefined,
): boolean {
  return (
    event?.loopOutcomeKind === "ready_gate_failed" &&
    event.resumable === true &&
    event.readyGateOrigin === "repair_budget_exhausted" &&
    event.readyGateRepairCount === MAX_READY_GATE_REPAIRS
  );
}

/** Whether `run` carries a same-run retained finalization checkpoint for gate-only resume. */
export function hasRetainedFinalizationCheckpoint(
  run: Run & { attempts: Array<{ id: string; outcomeKind?: string | null }> },
): boolean {
  if (run.retainedFinalizationCheckpointCorrupt === true) return false;
  const checkpoint = run.retainedFinalizationCheckpoint;
  if (checkpoint === undefined || checkpoint === null) return false;
  return run.attempts.some(
    (attempt) => attempt.id === checkpoint.completionAttemptId && attempt.outcomeKind === "done",
  );
}
