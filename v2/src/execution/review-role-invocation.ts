import {
  executeWithQuotaFallback,
  type InvocationBinding,
  type InvocationExecution,
  type InvocationTelemetryContext,
} from "../../../shared/invocation/execute.ts";
import type { InvocationFailureKind } from "./invocation-failure.ts";
import { DEFAULT_ITERATION_TIMEOUT_MS } from "./write-loop.ts";

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
): Promise<InvocationExecution> {
  args.onRoleStart?.(role);
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), args.roleTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS);
  const onCallerAbort = () => timeout.abort();
  args.signal?.addEventListener("abort", onCallerAbort, { once: true });
  if (args.signal?.aborted) timeout.abort();
  try {
    return await executeWithQuotaFallback({
      prompt,
      cwd: args.cwd,
      bindings,
      signal: timeout.signal,
      ...(args.telemetry !== undefined
        ? { telemetry: { ...args.telemetry, role, invocationIds: bindings.map(() => crypto.randomUUID()) } }
        : {}),
    });
  } finally {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", onCallerAbort);
  }
}

export function reviewRoleFailureKind(execution: InvocationExecution): InvocationFailureKind | null {
  if (execution.final === null) return "no_binding";
  return execution.final.result.kind === "ok" ? null : execution.final.result.kind;
}
