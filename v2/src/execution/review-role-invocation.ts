import {
  executeWithQuotaFallback,
  type InvocationBinding,
  type InvocationExecution,
  type InvocationTelemetryContext,
} from "../../../shared/invocation/execute.ts";
import { DEFAULT_REVIEW_ROLE_TIMEOUT_MS } from "../config/machine-config-loader.ts";
import type { InvocationFailureDetail, InvocationFailureKind } from "./invocation-failure.ts";

const DEFAULT_IDLE_OUTPUT_TIMEOUT_MS = 90_000;

export type ReviewRoleInvocationExecution = InvocationExecution & {
  roleTimeout?: Pick<InvocationFailureDetail, "role" | "agent" | "model" | "boundMs">;
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
  const attribution = (bound: number, metadata: InvocationBinding["metadata"]) => ({
    role,
    boundMs: bound,
    ...(metadata?.agent !== undefined ? { agent: metadata.agent } : {}),
    ...(metadata?.model !== undefined ? { model: metadata.model } : {}),
  });
  try {
    const execution = await executeWithQuotaFallback({
      prompt,
      cwd: args.cwd,
      bindings,
      signal: timeout.signal,
      idleOutputMs: idleBoundMs,
      ...(args.telemetry !== undefined
        ? { telemetry: { ...args.telemetry, role, invocationIds: bindings.map(() => crypto.randomUUID()) } }
        : {}),
    });
    if (!timedOut && !callerAborted && execution.final?.result.kind === "stall") {
      return { ...execution, idleTimeout: attribution(idleBoundMs, execution.final.binding.metadata) };
    }
    if (timedOut && !callerAborted) {
      return { ...execution, roleTimeout: attribution(boundMs, execution.final?.binding.metadata) };
    }
    return execution;
  } finally {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", onCallerAbort);
  }
}

export function reviewRoleFailureKind(execution: ReviewRoleInvocationExecution): InvocationFailureKind | null {
  if (execution.roleTimeout !== undefined) return "timeout";
  if (execution.idleTimeout !== undefined) return "stall";
  if (execution.final === null) return "no_binding";
  return execution.final.result.kind === "ok" ? null : execution.final.result.kind;
}
