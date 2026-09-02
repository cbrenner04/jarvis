import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createResolvedAgentBinding, type ResolvedAgentBinding } from "../../../shared/invocation/agents.ts";
import type { InvocationBinding, InvocationTelemetryContext } from "../../../shared/invocation/execute.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { resolveExecutableRole, resolveInvocationBindings } from "../config/agent-model-config.ts";
import type { LogSink } from "../persistence/log-stream.ts";
import { truncateLogText } from "../persistence/log-stream.ts";
import type { Attempt, Run, StateStore, WorkflowSnapshot } from "../persistence/state-store.ts";
import type { WriteLoopOutcomeKind } from "./write-loop.ts";
import {
  type InvocationFailureDetail,
  type InvocationFailureKind,
  isExhaustedRoleTimeout,
} from "./invocation-failure.ts";
import { checkPlanTreeLanding, type PublicationLanding } from "./publication-landing.ts";
import { executeReviewDebate, type ReviewDebateRole, type ReviewDebateRoleBindings } from "./review-debate.ts";
import { cycleProfileContext } from "./review-profile-context.ts";
import { rehydrateReviewPromptProfile } from "./review-profile-registry.ts";
import {
  invokeReviewRole,
  type ReviewRoleInvocationExecution,
  reviewRoleFailureKind,
} from "./review-role-invocation.ts";
import {
  lintReviewedStagedMarkdownOrFail,
  REVIEW_STAGED_MARKDOWN_LINT_MAX_REPROMPTS,
  type ReviewedStagedMarkdownLintReprompt,
  renderReviewedStagedMarkdownLintReprompt,
  reviewedStagingDir,
} from "./reviewed-staged-markdown-lint.ts";
import { isSuccessorShellStallOutcome, type SuccessorShellStallOutcome } from "./successor-step-idle-watchdog.ts";
import { buildJsonlSink } from "./telemetry-sink.ts";
import { defaultTelemetrySinkPath } from "./work-boundary-telemetry.ts";
import { checkStagedPlanDraft } from "./write.ts";
import type {
  ReviewDebateProgress,
  ReviewDebateWorkflowStep,
  ReviewStepOutcome,
  ReviewWorkflowStep,
} from "./workflow-runner.ts";

const REVIEW_DEBATE_ROLES: readonly ReviewDebateRole[] = ["adversary", "advocate", "adjudicator", "actuator"];

type WorkflowTelemetryContext = {
  operatorSessionId: string;
  workflow: string;
  sinkPath?: string;
};

export type ReviewDebateStepOutcome =
  | {
      kind: "complete";
      runId: string;
      iterationsConsumed: number;
      resumable: false;
      completionAgent?: string;
      reviewPass?: number;
    }
  | {
      kind: "landing_failed";
      runId: string;
      iterationsConsumed: number;
      resumable: boolean;
    }
  | {
      kind: "invocation_failure";
      runId: string;
      iterationsConsumed: number;
      resumable: boolean;
      invocationFailureMessage?: string;
    };

type ReviewedLandingActuatorRepromptContext = {
  cwd: string;
  bindings: readonly InvocationBinding[];
  resolveActuatorPrompt: (reprompt: ReviewedStagedMarkdownLintReprompt | undefined) => Promise<string>;
  roleTimeoutMs?: number;
  idleOutputMs?: number;
  signal?: AbortSignal;
  telemetry?: Omit<InvocationTelemetryContext, "role" | "invocationIds">;
  onActuatorStart?: () => void;
};

type ReviewStepBindings = {
  critic: readonly InvocationBinding[];
  actuator: readonly InvocationBinding[];
};

export type LandReviewedPublicationOutput = (
  worktreePath: string,
  deferred: Exclude<PublicationLanding, { kind: "none" }>,
  verdictPath: string,
  trace?: {
    logSink: LogSink | undefined;
    runId: string;
    branch: string;
    persistHandoff?: {
      store: StateStore;
      project: string;
      branch: string;
      writeTarget: string | { reviewRunId: string };
    };
  },
) => Promise<{ ok: true; specPath: string } | { ok: false; message: string }>;

export type ReviewDebateLandingDeps = {
  findReviewLandingCheckpoint: (
    store: StateStore,
    step: Pick<ReviewDebateWorkflowStep | ReviewWorkflowStep, "project" | "branch" | "stepId">,
  ) => (Run & { attempts: Attempt[] }) | undefined;
  reviewCompletionAgent: (run: Run & { attempts: Attempt[] }) => string | undefined;
  reviewCompletionPass: (run: Run & { attempts: Attempt[] }) => number | undefined;
  raceStepSuccessorShellIdle: <T>(
    step: { idleOutputMs?: number; signal?: AbortSignal },
    ctx: { runId: string; attemptId: string; store: StateStore; logSink?: LogSink },
    run: (handoff: { signal: AbortSignal | undefined; onRoleStart: () => void }) => Promise<T>,
  ) => Promise<T | SuccessorShellStallOutcome>;
  landReviewedPublicationOutput: LandReviewedPublicationOutput;
  resolveReviewStepBindings: (step: ReviewWorkflowStep) => ReviewStepBindings;
};

function completionBoundarySettlementFields(
  terminalCause: WriteLoopOutcomeKind,
  terminalFailureDetail?: InvocationFailureDetail,
): {
  terminalCause: WriteLoopOutcomeKind;
  terminalFailureDetail?: InvocationFailureDetail;
} {
  return {
    terminalCause,
    ...(terminalFailureDetail !== undefined ? { terminalFailureDetail } : {}),
  };
}

export function isPostCommitReviewRetryableFailureKind(
  detail: Pick<InvocationFailureDetail, "failureKind" | "exhaustedRoleTimeout">,
): boolean {
  if (detail.failureKind === "stall") return true;
  return detail.failureKind === "timeout" && !isExhaustedRoleTimeout(detail);
}

export function buildReviewInvocationFailureDetail(
  failureKind: InvocationFailureKind,
  failedRole: string,
  roleExecution: ReviewRoleInvocationExecution | undefined,
  message?: string,
): InvocationFailureDetail {
  const roleTimeout = roleExecution?.roleTimeout;
  const attribution = roleTimeout ?? roleExecution?.idleTimeout;
  return {
    failureKind,
    bindingAttempts: roleTimeout?.bindingAttempts ?? [],
    message:
      roleTimeout !== undefined
        ? `review: ${failedRole} exceeded ${roleTimeout.boundMs}ms bound (agent=${roleTimeout.agent ?? "unknown"}, model=${roleTimeout.model ?? "unknown"})`
        : (message ?? `review: ${failedRole} invocation failed (${failureKind})`),
    ...(attribution !== undefined ? attribution : {}),
  };
}

/** Drop approval-cycle verdict edits so the publication tail does not restage them as another review pass. */
export async function discardEphemeralReviewVerdictDrift(worktreePath: string, verdictPath: string): Promise<void> {
  if (!existsSync(join(worktreePath, ".git"))) return;
  const relativePath = relative(worktreePath, verdictPath);
  if (relativePath.startsWith("..")) return;
  try {
    await realAsyncSubprocessRunner.runAsync("git", ["restore", relativePath], worktreePath);
  } catch {
    if (existsSync(verdictPath)) rmSync(verdictPath, { force: true });
  }
}

function lastMutatingReviewPass<C extends { kind: string; actuatorRan?: boolean }>(
  cycles: readonly C[],
  actuatorAgent: (cycle: Extract<C, { kind: "completed" }>) => string | undefined,
): { pass: number; agent: string | undefined } | undefined {
  for (let index = cycles.length - 1; index >= 0; index -= 1) {
    const cycle = cycles[index];
    if (cycle !== undefined && cycle.kind === "completed" && cycle.actuatorRan) {
      return { pass: index + 1, agent: actuatorAgent(cycle as Extract<C, { kind: "completed" }>) };
    }
  }
  return undefined;
}

function reviewDebateResultOutcome(result: Awaited<ReturnType<typeof executeReviewDebate>>): {
  kind: "complete" | "invocation_failure";
  failureKind: InvocationFailureKind | undefined;
  terminalRole: ReviewDebateRole;
  completionAgent: string | undefined;
  reviewPass: number | undefined;
} {
  const lastCycle = result.cycles.at(-1);
  const kind = lastCycle?.kind === "role_failed" ? "invocation_failure" : "complete";
  const failureKind = lastCycle?.kind === "role_failed" ? lastCycle.failureKind : undefined;
  const terminalRole: ReviewDebateRole =
    lastCycle?.kind === "role_failed" ? lastCycle.failedRole : lastCycle?.actuatorRan ? "actuator" : "adjudicator";
  const mutating =
    kind === "complete"
      ? lastMutatingReviewPass(result.cycles, (cycle) =>
          cycle.roleResults.actuator?.final?.result.kind === "ok"
            ? cycle.roleResults.actuator.final.binding.metadata?.agent?.trim()
            : undefined,
        )
      : undefined;
  return { kind, failureKind, terminalRole, completionAgent: mutating?.agent, reviewPass: mutating?.pass };
}

function buildReviewRoleTelemetryFields(
  telemetry: WorkflowTelemetryContext | undefined,
  params: { runId: string; attemptId: string; project: string; stepId: string; cwd: string; branch: string },
): { telemetry?: Omit<InvocationTelemetryContext, "role" | "invocationIds"> } {
  if (telemetry === undefined) return {};
  return {
    telemetry: {
      sink: buildJsonlSink(telemetry.sinkPath ?? defaultTelemetrySinkPath()),
      operatorSessionId: telemetry.operatorSessionId,
      runId: params.runId,
      attemptId: params.attemptId,
      project: params.project,
      workflow: telemetry.workflow,
      stepId: params.stepId,
      worktreePath: params.cwd,
      branch: params.branch,
      specRef: "",
    },
  };
}

export function revalidateStagedPlanContract(stagingDir: string): { ok: true } | { ok: false; reason: string } {
  const draft = checkStagedPlanDraft(stagingDir);
  if (!draft.ok) return draft;
  return checkPlanTreeLanding(stagingDir);
}

async function finishReviewDebateLanding(
  step: ReviewDebateWorkflowStep,
  landing: Exclude<PublicationLanding, { kind: "none" }>,
  result: Awaited<ReturnType<typeof executeReviewDebate>>,
  bindings: ReviewDebateRoleBindings,
  attemptId: string,
  runId: string,
  store: StateStore,
  logSink: LogSink | undefined,
  telemetryFields: ReturnType<typeof buildReviewRoleTelemetryFields>,
  deps: ReviewDebateLandingDeps,
): Promise<ReviewDebateStepOutcome | undefined> {
  const lastCycle = result.cycles.at(-1);
  const actuatorRan = lastCycle?.kind === "completed" && lastCycle.actuatorRan;
  const verdict = lastCycle?.kind === "completed" || lastCycle?.kind === "role_failed" ? (lastCycle.verdict ?? "") : ""; // @mutate-equivalent mutation="operator-flip: === → !==" reason="Landing lint reprompt always passes reprompt; verdict is only read when reprompt is undefined"
  const priorCycle = result.cycles.at(-2);
  const priorVerdict = priorCycle?.kind === "completed" ? priorCycle.verdict : undefined;
  const actuatorContext = actuatorRan
    ? buildReviewDebateLandingActuatorContext(
        step,
        landing,
        bindings,
        verdict,
        cycleProfileContext(step.profileContext, result.cycles.length, priorVerdict),
        telemetryFields,
      )
    : undefined;
  const landingFailure = await landReviewedOutputOrFail(
    step,
    landing,
    attemptId,
    runId,
    result.cycles.length,
    store,
    logSink,
    deps,
    actuatorContext,
  );
  if (landingFailure === undefined) {
    return undefined;
  }
  if (landingFailure.kind === "landing_failed") {
    logSink?.append(runId, {
      kind: "loop_finished",
      loopOutcomeKind: "landing_failed",
      iterationsConsumed: landingFailure.iterationsConsumed,
      resumable: landingFailure.resumable,
    });
  }
  return landingFailure;
}

export async function runReviewDebateStep(
  step: ReviewDebateWorkflowStep,
  stepIndex: number,
  invocationId: string,
  onProgress: ((invocationId: string, stepId: string, progress: ReviewDebateProgress) => void) | undefined,
  telemetry: WorkflowTelemetryContext | undefined,
  onStepRunCreated: ((stepIndex: number, runId: string) => void) | undefined,
  store: StateStore,
  workflowSnapshot: WorkflowSnapshot,
  freshDispatch: boolean | undefined,
  logSink: LogSink | undefined,
  deps: ReviewDebateLandingDeps,
  onMutatingDebatePass?: (pass: number, agent: string | undefined) => Promise<void>,
): Promise<ReviewDebateStepOutcome | ReviewStepOutcome> {
  const {
    stepId,
    project,
    branch,
    agents,
    agentModelConfig,
    createBinding,
    profile: serializedProfile,
    landing,
    ...debateInput
  } = step;
  if (landing !== undefined && landing.kind !== "none" && !freshDispatch) {
    const checkpoint = deps.findReviewLandingCheckpoint(store, step);
    if (checkpoint !== undefined) {
      onStepRunCreated?.(stepIndex, checkpoint.id);
      return finishReviewedLanding(
        step,
        landing,
        checkpoint.id,
        store,
        deps.reviewCompletionAgent(checkpoint),
        deps.reviewCompletionPass(checkpoint),
        logSink,
        deps,
      );
    }
  }

  const resolveBindings = createBinding ?? createResolvedAgentBinding;

  if (!freshDispatch) {
    const actuatorOnlyRetry = await tryActuatorOnlyReviewDebateRetry(
      step,
      stepIndex,
      invocationId,
      onProgress,
      telemetry,
      onStepRunCreated,
      store,
      resolveBindings,
      logSink,
      deps,
    );
    if (actuatorOnlyRetry !== undefined) return actuatorOnlyRetry;
  }

  const runId = store.createRun({
    project,
    specRef: landing?.kind === "intent-stage" ? landing.baseRef : "",
    worktreePath: step.cwd,
    branch,
    specPath: step.verdictPath,
    stepId,
    workflowSnapshot,
  });
  const attemptId = store.recordAttemptStart(runId);
  onStepRunCreated?.(stepIndex, runId);
  logSink?.append(runId, { kind: "iteration_started", attemptId });

  const bindings = Object.fromEntries(
    REVIEW_DEBATE_ROLES.map((role) => [
      role,
      resolveInvocationBindings(resolveExecutableRole(role), agents[role], agentModelConfig, resolveBindings),
    ]),
  ) as ReviewDebateRoleBindings;

  const telemetryFields = buildReviewRoleTelemetryFields(telemetry, {
    runId,
    attemptId,
    project,
    stepId,
    cwd: step.cwd,
    branch,
  });

  let invocationCount = 0;
  const debateOutcome = await deps.raceStepSuccessorShellIdle(
    step,
    { runId, attemptId, store, ...(logSink !== undefined ? { logSink } : {}) },
    async ({ signal, onRoleStart }) => {
      const profile = rehydrateReviewPromptProfile(serializedProfile);
      return executeReviewDebate({
        ...debateInput,
        ...(profile !== undefined ? { profile } : {}),
        bindings,
        ...(signal !== undefined ? { signal } : {}),
        ...telemetryFields,
        onRoleStart: (role: ReviewDebateRole) => {
          onRoleStart();
          invocationCount += 1;
          onProgress?.(invocationId, stepId, { status: "in_progress", role });
        },
        ...(onMutatingDebatePass !== undefined
          ? { onMutatingCycleComplete: async ({ pass, agent }) => onMutatingDebatePass(pass, agent) }
          : {}),
      });
    },
  );

  if (isSuccessorShellStallOutcome(debateOutcome)) {
    return debateOutcome;
  }

  const result = debateOutcome;

  const { kind, failureKind, terminalRole, completionAgent, reviewPass } = reviewDebateResultOutcome(result);

  onProgress?.(invocationId, stepId, {
    status: kind === "complete" ? "completed" : "stopped",
    role: terminalRole,
    terminalOutcome: kind,
    attemptCount: Math.max(invocationCount, 1),
  });

  if (kind === "complete" && landing !== undefined && landing.kind !== "none") {
    const landingFailure = await finishReviewDebateLanding(
      step,
      landing,
      result,
      bindings,
      attemptId,
      runId,
      store,
      logSink,
      telemetryFields,
      deps,
    );
    if (landingFailure !== undefined) {
      return landingFailure;
    }
  }

  if (kind === "complete") {
    await discardEphemeralReviewVerdictDrift(step.cwd, step.verdictPath);
  }

  const failed = result.cycles.at(-1);
  const failureDetail =
    kind === "invocation_failure" && failureKind !== undefined && failed?.kind === "role_failed"
      ? buildReviewInvocationFailureDetail(failureKind, failed.failedRole, failed.roleResults[failed.failedRole])
      : undefined;

  commitReviewDebateOutcome(store, attemptId, kind, failureDetail, completionAgent, reviewPass);

  const retryableFailure =
    kind === "invocation_failure" &&
    failureDetail !== undefined &&
    isPostCommitReviewRetryableFailureKind(failureDetail);

  return {
    kind,
    runId,
    iterationsConsumed: result.cycles.length,
    resumable: retryableFailure,
    ...(completionAgent ? { completionAgent } : {}),
    ...(reviewPass !== undefined ? { reviewPass } : {}),
  };
}

function commitReviewDebateOutcome(
  store: StateStore,
  attemptId: string,
  kind: "complete" | "invocation_failure",
  failureDetail: InvocationFailureDetail | undefined,
  completionAgent: string | undefined,
  reviewPass: number | undefined,
): void {
  if (kind === "invocation_failure") {
    store.commitCompletionBoundary({
      attemptId,
      runStatus: "failed",
      outcomeKind: "invocation_failure",
      ...(failureDetail !== undefined ? { invocationFailureDetail: failureDetail } : {}),
      ...completionBoundarySettlementFields("invocation_failure", failureDetail),
    });
    return;
  }
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "completed",
    outcomeKind: "done",
    terminalCause: "complete",
    ...(completionAgent ? { completionAgent } : {}),
    ...(reviewPass !== undefined ? { completionReviewPass: reviewPass } : {}),
  });
}

export function settleReviewedStagedMarkdownLintFailure(
  store: StateStore,
  attemptId: string,
  runId: string,
  iterationsConsumed: number,
  resumable: boolean,
  logSink?: LogSink,
): ReviewDebateStepOutcome {
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "landing_failed",
    ...completionBoundarySettlementFields("landing_failed"),
  });
  logSink?.append(runId, {
    kind: "boundary_committed",
    attemptId,
    outcomeKind: "landing_failed",
    runStatus: "failed",
  });
  return {
    kind: "landing_failed",
    runId,
    iterationsConsumed,
    resumable,
  };
}

function buildReviewDebateLandingActuatorContext(
  step: ReviewDebateWorkflowStep,
  landing: Exclude<PublicationLanding, { kind: "none" }>,
  bindings: ReviewDebateRoleBindings,
  verdict: string,
  profileContext: unknown,
  telemetryFields: { telemetry?: Omit<InvocationTelemetryContext, "role" | "invocationIds"> },
  hooks?: { signal?: AbortSignal; onActuatorStart?: () => void },
): ReviewedLandingActuatorRepromptContext {
  const profile = rehydrateReviewPromptProfile(step.profile);
  const stagingDir = reviewedStagingDir(landing) ?? "";
  return {
    cwd: step.cwd,
    bindings: bindings.actuator,
    resolveActuatorPrompt: async (reprompt) => {
      if (reprompt !== undefined) {
        return renderReviewedStagedMarkdownLintReprompt(reprompt, stagingDir);
      }
      if (profile?.render.actuator) {
        return await profile.render.actuator(profileContext, verdict);
      }
      return verdict;
    },
    ...(step.roleTimeoutMs !== undefined ? { roleTimeoutMs: step.roleTimeoutMs } : {}),
    ...(step.idleOutputMs !== undefined ? { idleOutputMs: step.idleOutputMs } : {}),
    ...(hooks?.signal !== undefined ? { signal: hooks.signal } : {}),
    ...(telemetryFields.telemetry !== undefined ? { telemetry: telemetryFields.telemetry } : {}),
    ...(hooks?.onActuatorStart !== undefined ? { onActuatorStart: hooks.onActuatorStart } : {}),
  };
}

export function buildStandardReviewLandingActuatorContext(
  step: ReviewWorkflowStep,
  landing: Exclude<PublicationLanding, { kind: "none" }>,
  bindings: ReviewStepBindings,
  verdict: string,
  profileContext: unknown,
  telemetryFields: { telemetry?: Omit<InvocationTelemetryContext, "role" | "invocationIds"> },
  hooks?: { signal?: AbortSignal; onActuatorStart?: () => void },
): ReviewedLandingActuatorRepromptContext {
  const profile = rehydrateReviewPromptProfile(step.profile);
  const stagingDir = reviewedStagingDir(landing) ?? "";
  return {
    cwd: step.cwd,
    bindings: bindings.actuator,
    resolveActuatorPrompt: async (reprompt) => {
      if (reprompt !== undefined) {
        return renderReviewedStagedMarkdownLintReprompt(reprompt, stagingDir);
      }
      if (profile?.render.actuator) {
        return await profile.render.actuator(profileContext, verdict);
      }
      return verdict;
    },
    ...(step.roleTimeoutMs !== undefined ? { roleTimeoutMs: step.roleTimeoutMs } : {}),
    ...(step.idleOutputMs !== undefined ? { idleOutputMs: step.idleOutputMs } : {}),
    ...(hooks?.signal !== undefined ? { signal: hooks.signal } : {}),
    ...(telemetryFields.telemetry !== undefined ? { telemetry: telemetryFields.telemetry } : {}),
    ...(hooks?.onActuatorStart !== undefined ? { onActuatorStart: hooks.onActuatorStart } : {}),
  };
}

async function repromptReviewedStagedMarkdownLintOrFail(
  step: Pick<ReviewDebateWorkflowStep | ReviewWorkflowStep, "cwd" | "stagedMarkdownLintMaxReprompts">,
  landing: Exclude<PublicationLanding, { kind: "none" }>,
  attemptId: string,
  runId: string,
  iterationsConsumed: number,
  store: StateStore,
  logSink: LogSink | undefined,
  actuatorContext: ReviewedLandingActuatorRepromptContext | undefined,
  maxReprompts: number,
): Promise<ReviewDebateStepOutcome | undefined> {
  let lintRepromptsRemaining = maxReprompts;

  while (true) {
    const lintResult = await lintReviewedStagedMarkdownOrFail(step.cwd, landing);
    if (lintResult.kind === "skip" || lintResult.kind === "pass") {
      return undefined;
    }
    if (lintResult.kind === "invocation_error") {
      return settleReviewedStagedMarkdownLintFailure(store, attemptId, runId, iterationsConsumed, false, logSink);
    }
    if (actuatorContext === undefined || lintRepromptsRemaining <= 0) {
      return settleReviewedStagedMarkdownLintFailure(store, attemptId, runId, iterationsConsumed, true, logSink);
    }

    lintRepromptsRemaining -= 1;
    logSink?.append(runId, {
      kind: "staged_markdown_lint_reprompt",
      attemptId,
      ruleId: lintResult.ruleId,
      violation: truncateLogText(lintResult.message),
      offendingFile: lintResult.filePath,
    });

    const reprompt: ReviewedStagedMarkdownLintReprompt = {
      ruleId: lintResult.ruleId,
      offendingFile: lintResult.filePath,
      message: lintResult.message,
    };
    const prompt = await actuatorContext.resolveActuatorPrompt(reprompt);
    const execution = await invokeReviewRole(
      {
        cwd: actuatorContext.cwd,
        ...(actuatorContext.roleTimeoutMs !== undefined ? { roleTimeoutMs: actuatorContext.roleTimeoutMs } : {}),
        ...(actuatorContext.idleOutputMs !== undefined ? { idleOutputMs: actuatorContext.idleOutputMs } : {}),
        ...(actuatorContext.signal !== undefined ? { signal: actuatorContext.signal } : {}),
        ...(actuatorContext.telemetry !== undefined ? { telemetry: actuatorContext.telemetry } : {}),
        onRoleStart: () => actuatorContext.onActuatorStart?.(),
      },
      "actuator",
      prompt,
      actuatorContext.bindings,
    );
    const failureKind = reviewRoleFailureKind(execution);
    if (failureKind !== null) {
      const detail = buildReviewInvocationFailureDetail(failureKind, "actuator", execution);
      store.commitCompletionBoundary({
        attemptId,
        runStatus: "failed",
        outcomeKind: "invocation_failure",
        invocationFailureDetail: detail,
        ...completionBoundarySettlementFields("invocation_failure", detail),
      });
      return {
        kind: "invocation_failure",
        runId,
        iterationsConsumed,
        resumable: isPostCommitReviewRetryableFailureKind(detail),
      };
    }
  }
}

export async function landReviewedOutputOrFail(
  step: Pick<
    ReviewDebateWorkflowStep | ReviewWorkflowStep,
    | "cwd"
    | "verdictPath"
    | "branch"
    | "project"
    | "stagedMarkdownLintMaxReprompts"
    | "revalidateStagedPlanBeforeLanding"
  >,
  landing: Exclude<PublicationLanding, { kind: "none" }>,
  attemptId: string,
  runId: string,
  iterationsConsumed: number,
  store: StateStore,
  logSink: LogSink | undefined,
  deps: Pick<ReviewDebateLandingDeps, "landReviewedPublicationOutput">,
  actuatorContext?: ReviewedLandingActuatorRepromptContext,
  options?: { stagedMarkdownLintMaxReprompts?: number },
): Promise<ReviewDebateStepOutcome | undefined> {
  if (step.revalidateStagedPlanBeforeLanding === true && landing.kind === "plan-tree") {
    const contract = revalidateStagedPlanContract(resolve(step.cwd, landing.stagingDir));
    if (!contract.ok) {
      store.commitCompletionBoundary({
        attemptId,
        runStatus: "failed",
        outcomeKind: "invocation_failure",
        invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message: contract.reason },
        ...completionBoundarySettlementFields("invocation_failure", {
          failureKind: "landing",
          bindingAttempts: [],
          message: contract.reason,
        }),
      });
      return { kind: "invocation_failure", runId, iterationsConsumed, resumable: true };
    }
  }

  const maxReprompts =
    options?.stagedMarkdownLintMaxReprompts ??
    step.stagedMarkdownLintMaxReprompts ??
    REVIEW_STAGED_MARKDOWN_LINT_MAX_REPROMPTS;
  const lintFailure = await repromptReviewedStagedMarkdownLintOrFail(
    step,
    landing,
    attemptId,
    runId,
    iterationsConsumed,
    store,
    logSink,
    actuatorContext,
    maxReprompts,
  );
  if (lintFailure !== undefined) {
    return lintFailure;
  }

  const landed = await deps.landReviewedPublicationOutput(step.cwd, landing, step.verdictPath, {
    logSink,
    runId,
    branch: step.branch,
    persistHandoff: { store, project: step.project, branch: step.branch, writeTarget: { reviewRunId: runId } },
  });
  if (landed.ok) return undefined;
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "invocation_failure",
    invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message: landed.message },
    ...completionBoundarySettlementFields("invocation_failure", {
      failureKind: "landing",
      bindingAttempts: [],
      message: landed.message,
    }),
  });
  return { kind: "invocation_failure", runId, iterationsConsumed, resumable: true };
}

async function tryActuatorOnlyReviewDebateRetry(
  step: ReviewDebateWorkflowStep,
  stepIndex: number,
  invocationId: string,
  onProgress: ((invocationId: string, stepId: string, progress: ReviewDebateProgress) => void) | undefined,
  telemetry: WorkflowTelemetryContext | undefined,
  onStepRunCreated: ((stepIndex: number, runId: string) => void) | undefined,
  store: StateStore,
  resolveBindings: (binding: ResolvedAgentBinding) => InvocationBinding,
  logSink: LogSink | undefined,
  deps: ReviewDebateLandingDeps,
): Promise<ReviewDebateStepOutcome | undefined> {
  if (step.maxCycles > 1) return undefined;
  const existingRun = store.findRunByProjectBranch({ project: step.project, branch: step.branch, stepId: step.stepId });
  if (existingRun === null || existingRun.status !== "failed") return undefined;
  const lastAttempt = existingRun.attempts.at(-1);
  const detail = lastAttempt?.invocationFailureDetail;
  if (
    lastAttempt?.outcomeKind !== "invocation_failure" ||
    detail?.role !== "actuator" ||
    detail.failureKind === undefined ||
    !isPostCommitReviewRetryableFailureKind(detail)
  ) {
    return undefined;
  }

  const runId = existingRun.id;
  onStepRunCreated?.(stepIndex, runId);
  const attemptId = store.recordAttemptStart(runId);
  logSink?.append(runId, { kind: "iteration_started", attemptId });

  let invocationCount = 0;
  const shellOutcome = await deps.raceStepSuccessorShellIdle(
    step,
    { runId, attemptId, store, ...(logSink !== undefined ? { logSink } : {}) },
    async ({ signal, onRoleStart }) => {
      const verdict = existsSync(step.verdictPath) ? readFileSync(step.verdictPath, "utf8") : "";
      if (verdict.trim().length === 0) {
        const message = `review-debate actuator retry: missing or empty verdict at ${step.verdictPath}`;
        store.commitCompletionBoundary({
          attemptId,
          runStatus: "failed",
          outcomeKind: "invocation_failure",
          invocationFailureDetail: { failureKind: "error", bindingAttempts: [], message },
          ...completionBoundarySettlementFields("invocation_failure", {
            failureKind: "error",
            bindingAttempts: [],
            message,
          }),
        });
        return { kind: "missing_verdict" as const, message };
      }

      const bindings = resolveInvocationBindings(
        resolveExecutableRole("actuator"),
        step.agents.actuator,
        step.agentModelConfig,
        resolveBindings,
      );

      const profile = rehydrateReviewPromptProfile(step.profile);
      const profileContext = cycleProfileContext(step.profileContext, 1, undefined);
      const prompt = profile?.render.actuator ? await profile.render.actuator(profileContext, verdict) : verdict;

      const telemetryFields = buildReviewRoleTelemetryFields(telemetry, {
        runId,
        attemptId,
        project: step.project,
        stepId: step.stepId,
        cwd: step.cwd,
        branch: step.branch,
      });

      const execution = await invokeReviewRole(
        {
          cwd: step.cwd,
          ...(signal !== undefined ? { signal } : {}),
          ...(step.roleTimeoutMs !== undefined ? { roleTimeoutMs: step.roleTimeoutMs } : {}),
          ...(step.idleOutputMs !== undefined ? { idleOutputMs: step.idleOutputMs } : {}),
          ...telemetryFields,
          onRoleStart: () => {
            onRoleStart();
            invocationCount += 1;
            onProgress?.(invocationId, step.stepId, { status: "in_progress", role: "actuator" });
          },
        },
        "actuator",
        prompt,
        bindings,
      );
      return { kind: "execution" as const, execution };
    },
  );

  if (isSuccessorShellStallOutcome(shellOutcome)) {
    return shellOutcome;
  }

  if (shellOutcome.kind === "missing_verdict") {
    return {
      kind: "invocation_failure",
      runId,
      iterationsConsumed: 0,
      resumable: false,
      invocationFailureMessage: shellOutcome.message,
    };
  }

  const execution = shellOutcome.execution;

  const failureKind = reviewRoleFailureKind(execution);

  onProgress?.(invocationId, step.stepId, {
    status: failureKind === null ? "completed" : "stopped",
    role: "actuator",
    terminalOutcome: failureKind === null ? "complete" : "invocation_failure",
    attemptCount: Math.max(invocationCount, 1),
  });

  if (failureKind !== null) {
    const detail = buildReviewInvocationFailureDetail(failureKind, "actuator", execution);
    store.commitCompletionBoundary({
      attemptId,
      runStatus: "failed",
      outcomeKind: "invocation_failure",
      invocationFailureDetail: detail,
      ...completionBoundarySettlementFields("invocation_failure", detail),
    });
    return {
      kind: "invocation_failure",
      runId,
      iterationsConsumed: 1,
      resumable: isPostCommitReviewRetryableFailureKind(detail),
    };
  }

  const completionAgent =
    execution.final?.result.kind === "ok" ? execution.final.binding.metadata?.agent?.trim() : undefined;

  if (step.landing !== undefined && step.landing.kind !== "none") {
    const profileContext = cycleProfileContext(step.profileContext, 1, undefined);
    const verdict = existsSync(step.verdictPath) ? readFileSync(step.verdictPath, "utf8") : "";
    const actuatorBindings = resolveInvocationBindings(
      resolveExecutableRole("actuator"),
      step.agents.actuator,
      step.agentModelConfig,
      step.createBinding ?? createResolvedAgentBinding,
    );
    const telemetryFields = buildReviewRoleTelemetryFields(telemetry, {
      runId,
      attemptId,
      project: step.project,
      stepId: step.stepId,
      cwd: step.cwd,
      branch: step.branch,
    });
    const actuatorContext = buildReviewDebateLandingActuatorContext(
      step,
      step.landing,
      {
        adversary: [],
        advocate: [],
        adjudicator: [],
        actuator: actuatorBindings,
      },
      verdict,
      profileContext,
      telemetryFields,
    );
    const landingFailure = await landReviewedOutputOrFail(
      step,
      step.landing,
      attemptId,
      runId,
      1,
      store,
      logSink,
      deps,
      actuatorContext,
    );
    if (landingFailure !== undefined) {
      if (landingFailure.kind === "landing_failed") {
        logSink?.append(runId, {
          kind: "loop_finished",
          loopOutcomeKind: "landing_failed",
          iterationsConsumed: landingFailure.iterationsConsumed,
          resumable: landingFailure.resumable,
        });
      }
      return landingFailure;
    }
  }

  store.commitCompletionBoundary({
    attemptId,
    runStatus: "completed",
    outcomeKind: "done",
    terminalCause: "complete",
    ...(completionAgent ? { completionAgent } : {}),
    completionReviewPass: 1,
  });

  return {
    kind: "complete",
    runId,
    iterationsConsumed: 1,
    resumable: false,
    ...(completionAgent ? { completionAgent } : {}),
    reviewPass: 1,
  };
}

function buildCheckpointReviewLandingActuatorContext(
  step: ReviewDebateWorkflowStep | ReviewWorkflowStep,
  landing: Exclude<PublicationLanding, { kind: "none" }>,
  deps: Pick<ReviewDebateLandingDeps, "resolveReviewStepBindings">,
): ReviewedLandingActuatorRepromptContext {
  const verdict = existsSync(step.verdictPath) ? readFileSync(step.verdictPath, "utf8") : "";
  if (step.behavior === "review-debate") {
    const resolveBindings = step.createBinding ?? createResolvedAgentBinding;
    const bindings = Object.fromEntries(
      REVIEW_DEBATE_ROLES.map((role) => [
        role,
        resolveInvocationBindings(
          resolveExecutableRole(role),
          step.agents[role],
          step.agentModelConfig,
          resolveBindings,
        ),
      ]),
    ) as ReviewDebateRoleBindings;
    return buildReviewDebateLandingActuatorContext(step, landing, bindings, verdict, step.profileContext, {});
  }
  const bindings = deps.resolveReviewStepBindings(step);
  return buildStandardReviewLandingActuatorContext(step, landing, bindings, verdict, step.profileContext ?? {}, {});
}

export async function finishReviewedLanding(
  step: ReviewDebateWorkflowStep | ReviewWorkflowStep,
  deferred: Exclude<PublicationLanding, { kind: "none" }>,
  runId: string,
  store: StateStore,
  completionAgent: string | undefined,
  reviewPass: number | undefined,
  logSink: LogSink | undefined,
  deps: ReviewDebateLandingDeps,
): Promise<ReviewStepOutcome> {
  const attemptId = store.recordAttemptStart(runId);
  logSink?.append(runId, { kind: "iteration_started", attemptId });
  const landingFailure = await landReviewedOutputOrFail(
    step,
    deferred,
    attemptId,
    runId,
    0,
    store,
    logSink,
    deps,
    buildCheckpointReviewLandingActuatorContext(step, deferred, deps),
  );
  if (landingFailure !== undefined) {
    if (landingFailure.kind === "landing_failed") {
      logSink?.append(runId, {
        kind: "loop_finished",
        loopOutcomeKind: "landing_failed",
        iterationsConsumed: landingFailure.iterationsConsumed,
        resumable: landingFailure.resumable,
      });
    } else if (
      landingFailure.kind === "invocation_failure" &&
      store.loadRun(runId)?.attempts.at(-1)?.invocationFailureDetail?.failureKind === "landing"
    ) {
      logSink?.append(runId, {
        kind: "loop_finished",
        loopOutcomeKind: landingFailure.kind,
        iterationsConsumed: landingFailure.iterationsConsumed,
        resumable: landingFailure.resumable,
      });
    }
    return landingFailure;
  }
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "completed",
    outcomeKind: "done",
    terminalCause: "complete",
    ...(completionAgent ? { completionAgent } : {}),
    ...(reviewPass !== undefined ? { completionReviewPass: reviewPass } : {}),
  });
  const outcome: ReviewStepOutcome = {
    kind: "complete",
    runId,
    iterationsConsumed: 0,
    resumable: false,
    ...(completionAgent ? { completionAgent } : {}),
    ...(reviewPass !== undefined ? { reviewPass } : {}),
  };
  logSink?.append(runId, {
    kind: "loop_finished",
    loopOutcomeKind: outcome.kind,
    iterationsConsumed: outcome.iterationsConsumed,
    resumable: outcome.resumable,
  });
  return outcome;
}
