import {
  executeWithQuotaFallback,
  type InvocationBinding,
  type InvocationExecution,
  type InvocationTelemetryContext,
} from "../../../shared/invocation/execute.ts";
import type { InvocationFailureDetail, InvocationFailureKind } from "./invocation-failure.ts";
import { DEFAULT_ITERATION_TIMEOUT_MS } from "./write-loop.ts";

export type ReviewRoleInvocationExecution = InvocationExecution & {
  roleTimeout?: Pick<InvocationFailureDetail, "role" | "agent" | "model" | "boundMs">;
};

/**
 * One role invocation for review executors (critic/actuator and the debate roles).
 * Always armed with the write-loop wall clock so a hung agent cannot wedge the
 * run `in-progress` forever; the caller's signal aborts early.
 */
export async function invokeReviewRole<Role extends string>(
  args: {
    cwd: string;
    signal?: AbortSignal;
    telemetry?: Omit<InvocationTelemetryContext, "role" | "invocationIds">;
    onRoleStart?: (role: Role) => void;
    roleTimeoutMs?: number;
  },
  role: Role,
  prompt: string,
  bindings: readonly InvocationBinding[],
): Promise<ReviewRoleInvocationExecution> {
  args.onRoleStart?.(role);
  const boundMs = args.roleTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS;
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
  try {
    const execution = await executeWithQuotaFallback({
      prompt,
      cwd: args.cwd,
      bindings,
      signal: timeout.signal,
      ...(args.telemetry !== undefined
        ? { telemetry: { ...args.telemetry, role, invocationIds: bindings.map(() => crypto.randomUUID()) } }
        : {}),
    });
    if (timedOut && !callerAborted) {
      const metadata = execution.final?.binding.metadata;
      return {
        ...execution,
        roleTimeout: {
          role,
          boundMs,
          ...(metadata?.agent !== undefined ? { agent: metadata.agent } : {}),
          ...(metadata?.model !== undefined ? { model: metadata.model } : {}),
        },
      };
    }
    return execution;
  } finally {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", onCallerAbort);
  }
}

export function reviewRoleFailureKind(execution: ReviewRoleInvocationExecution): InvocationFailureKind | null {
  if (execution.roleTimeout !== undefined) return "timeout";
  if (execution.final === null) return "no_binding";
  return execution.final.result.kind === "ok" ? null : execution.final.result.kind;
}
