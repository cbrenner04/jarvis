import {
  executeWithQuotaFallback,
  type InvocationAttempt,
  type InvocationBinding,
  type InvocationExecution,
  type InvocationTelemetryContext,
  type InvocationTelemetryFailure,
} from "../../../shared/invocation/execute.ts";
import { DEFAULT_REVIEW_ROLE_TIMEOUT_MS } from "../config/machine-config-loader.ts";
import type { BindingAttemptSummary, InvocationFailureDetail, InvocationFailureKind } from "./invocation-failure.ts";

const DEFAULT_IDLE_OUTPUT_TIMEOUT_MS = 90_000;

export type ReviewRoleInvocationExecution = InvocationExecution & {
  roleTimeout?: Pick<InvocationFailureDetail, "role" | "agent" | "model" | "boundMs" | "exhaustedRoleTimeout"> & {
    bindingAttempts?: BindingAttemptSummary[];
  };
  idleTimeout?: Pick<InvocationFailureDetail, "role" | "agent" | "model" | "boundMs">;
};

/**
 * One role invocation for review executors (critic/actuator and the debate roles).
 * Always armed with the review-role wall clock so a hung agent cannot wedge the
 * run `in-progress` forever; the caller's signal aborts early. Also armed with
 * an idle-output budget: no stdout/stderr for idleOutputMs results in a stall.
 */
export async function invokeReviewRole<Role extends string>(
  args: {
    cwd: string;
    signal?: AbortSignal;
    telemetry?: Omit<InvocationTelemetryContext, "role" | "invocationIds">;
    onRoleStart?: (role: Role) => void;
    roleTimeoutMs?: number;
    idleOutputMs?: number;
  },
  role: Role,
  prompt: string,
  bindings: readonly InvocationBinding[],
): Promise<ReviewRoleInvocationExecution> {
  args.onRoleStart?.(role);
  const boundMs = args.roleTimeoutMs ?? DEFAULT_REVIEW_ROLE_TIMEOUT_MS;
  const idleBoundMs = args.idleOutputMs ?? DEFAULT_IDLE_OUTPUT_TIMEOUT_MS;
  const metadataFields = (metadata: InvocationBinding["metadata"]) => ({
    ...(metadata?.agent !== undefined ? { agent: metadata.agent } : {}),
    ...(metadata?.model !== undefined ? { model: metadata.model } : {}),
  });
  const attribution = (bound: number, metadata: InvocationBinding["metadata"]) => ({
    role,
    boundMs: bound,
    ...metadataFields(metadata),
  });

  const mergedAttempts: InvocationAttempt[] = [];
  const mergedTelemetryFailures: InvocationTelemetryFailure[] = [];
  const wallClockTimedOutAttempts = new Set<InvocationAttempt>();
  let startIndex = 0;

  for (;;) {
    const timeout = new AbortController();
    let timedOut = false;
    let callerAborted = false;
    const timer = setTimeout(() => {
      timedOut = true;
      timeout.abort();
    }, boundMs);
    const onCallerAbort = () => {
      callerAborted = true;
      timeout.abort();
    };
    args.signal?.addEventListener("abort", onCallerAbort, { once: true });
    if (args.signal?.aborted) onCallerAbort();

    const segmentBindings = bindings.slice(startIndex);
    let execution: InvocationExecution;
    try {
      execution = await executeWithQuotaFallback({
        prompt,
        cwd: args.cwd,
        bindings: segmentBindings,
        signal: timeout.signal,
        idleOutputMs: idleBoundMs,
        ...(args.telemetry !== undefined
          ? { telemetry: { ...args.telemetry, role, invocationIds: segmentBindings.map(() => crypto.randomUUID()) } }
          : {}),
      });
    } finally {
      clearTimeout(timer);
      args.signal?.removeEventListener("abort", onCallerAbort);
    }

    mergedAttempts.push(...execution.attempts);
    mergedTelemetryFailures.push(...execution.telemetryFailures);
    const merged: InvocationExecution = {
      attempts: mergedAttempts,
      final: execution.final,
      telemetryFailures: mergedTelemetryFailures,
    };

    if (execution.final?.result.kind === "ok") {
      return merged;
    }
    if (!timedOut && !callerAborted && execution.final?.result.kind === "stall") {
      return { ...merged, idleTimeout: attribution(idleBoundMs, execution.final.binding.metadata) };
    }
    if (timedOut && !callerAborted) {
      if (execution.final !== null) wallClockTimedOutAttempts.add(execution.final);
      const nextIndex = startIndex + execution.attempts.length;
      if (nextIndex < bindings.length) {
        startIndex = nextIndex;
        continue;
      }
      const bindingAttempts: InvocationFailureDetail["bindingAttempts"] = mergedAttempts.map((attempt) => ({
        bindingId: attempt.binding.id,
        resultKind: wallClockTimedOutAttempts.has(attempt) ? "timeout" : attempt.result.kind,
        ...metadataFields(attempt.binding.metadata),
      }));
      const exhaustedRoleTimeout = mergedAttempts.every((attempt) => wallClockTimedOutAttempts.has(attempt));
      return {
        ...merged,
        roleTimeout: {
          ...attribution(boundMs, execution.final?.binding.metadata),
          bindingAttempts,
          exhaustedRoleTimeout,
        },
      };
    }
    return merged;
  }
}

export function reviewRoleFailureKind(execution: ReviewRoleInvocationExecution): InvocationFailureKind | null {
  if (execution.roleTimeout !== undefined) return "timeout";
  if (execution.idleTimeout !== undefined) return "stall";
  if (execution.final === null) return "no_binding";
  return execution.final.result.kind === "ok" ? null : execution.final.result.kind;
}
