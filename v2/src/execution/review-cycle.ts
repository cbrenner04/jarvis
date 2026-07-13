import { writeFileSync } from "node:fs";
import {
  executeWithQuotaFallback,
  type InvocationBinding,
  type InvocationExecution,
  type InvocationOk,
  type InvocationTelemetryContext,
} from "../../../shared/invocation/execute.ts";
import type { InvocationFailureKind } from "./invocation-failure.ts";

export type ReviewCycleRole = "critic" | "actuator";

/** Critic bindings are read-only by caller convention; the executor adds no sandbox. */
export type ReviewCycleRoleBindings = {
  critic: readonly InvocationBinding[];
  actuator: readonly InvocationBinding[];
};

export type ReviewCycleInput = {
  cwd: string;
  prompt: string | (() => string);
  bindings: ReviewCycleRoleBindings;
  verdictPath: string;
  maxCycles: number;
  signal?: AbortSignal;
  telemetry?: Omit<InvocationTelemetryContext, "role" | "invocationIds">;
  onRoleStart?: (role: ReviewCycleRole) => void;
  actuatorPromptRenderer?: (verdict: string) => string;
};

export type ReviewCycleOutcome =
  | {
      kind: "completed";
      verdict: string;
      actuatorRan: boolean;
      roleResults: Partial<Record<ReviewCycleRole, InvocationExecution>>;
    }
  | {
      kind: "role_failed";
      failedRole: ReviewCycleRole;
      failureKind: InvocationFailureKind;
      verdict: string | null;
      roleResults: Partial<Record<ReviewCycleRole, InvocationExecution>>;
    }
  | {
      kind: "invocation_failure";
      failureKind: "error";
      verdict: string | null;
      roleResults: Partial<Record<ReviewCycleRole, InvocationExecution>>;
    };

export type ReviewCycleResult =
  | { kind: "complete"; cycles: ReviewCycleOutcome[] }
  | {
      kind: "invocation_failure";
      failureKind: "error" | InvocationFailureKind;
      failedRole?: ReviewCycleRole;
      cycles: ReviewCycleOutcome[];
    };

export async function executeReviewCycle(args: ReviewCycleInput): Promise<ReviewCycleResult> {
  if (!Number.isFinite(args.maxCycles) || !Number.isInteger(args.maxCycles) || args.maxCycles < 0) {
    throw new RangeError("maxCycles must be a finite non-negative integer");
  }

  const cycles: ReviewCycleOutcome[] = [];
  for (let cycle = 0; cycle < args.maxCycles; cycle += 1) {
    try {
      writeFileSync(args.verdictPath, "", "utf8");
    } catch {
      return { kind: "invocation_failure", failureKind: "error", cycles };
    }

    const roleResults: Partial<Record<ReviewCycleRole, InvocationExecution>> = {};
    const criticPrompt = typeof args.prompt === "function" ? args.prompt() : args.prompt;
    const critic = await invokeRole(args, "critic", criticPrompt, args.bindings.critic);
    roleResults.critic = critic;
    const criticFailure = failureKind(critic);
    if (criticFailure !== null) {
      const outcome = roleFailedOutcome("critic", criticFailure, null, roleResults);
      cycles.push(outcome);
      return { kind: "invocation_failure", failureKind: criticFailure, failedRole: "critic", cycles };
    }

    const verdict = (critic.final?.result as InvocationOk).stdout;
    try {
      writeFileSync(args.verdictPath, verdict, "utf8");
    } catch {
      const outcome: ReviewCycleOutcome = { kind: "invocation_failure", failureKind: "error", verdict, roleResults };
      cycles.push(outcome);
      return { kind: "invocation_failure", failureKind: "error", cycles };
    }

    if (verdict.trim().length === 0) {
      cycles.push({ kind: "completed", verdict, actuatorRan: false, roleResults });
      return { kind: "complete", cycles };
    }

    const actuatorPrompt = args.actuatorPromptRenderer ? args.actuatorPromptRenderer(verdict) : verdict;
    const actuator = await invokeRole(args, "actuator", actuatorPrompt, args.bindings.actuator);
    roleResults.actuator = actuator;
    const actuatorFailure = failureKind(actuator);
    if (actuatorFailure !== null) {
      const outcome = roleFailedOutcome("actuator", actuatorFailure, verdict, roleResults);
      cycles.push(outcome);
      return { kind: "invocation_failure", failureKind: actuatorFailure, failedRole: "actuator", cycles };
    }

    cycles.push({ kind: "completed", verdict, actuatorRan: true, roleResults });
  }

  return { kind: "complete", cycles };
}

function roleFailedOutcome(
  failedRole: ReviewCycleRole,
  failureKindValue: InvocationFailureKind,
  verdict: string | null,
  roleResults: Partial<Record<ReviewCycleRole, InvocationExecution>>,
): ReviewCycleOutcome {
  return { kind: "role_failed", failedRole, failureKind: failureKindValue, verdict, roleResults };
}

function failureKind(execution: InvocationExecution): InvocationFailureKind | null {
  if (execution.final === null) return "no_binding";
  return execution.final.result.kind === "ok" ? null : execution.final.result.kind;
}

async function invokeRole(
  args: ReviewCycleInput,
  role: ReviewCycleRole,
  prompt: string,
  bindings: readonly InvocationBinding[],
): Promise<InvocationExecution> {
  args.onRoleStart?.(role);
  return executeWithQuotaFallback({
    prompt,
    cwd: args.cwd,
    bindings,
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
    ...(args.telemetry !== undefined
      ? { telemetry: { ...args.telemetry, role, invocationIds: bindings.map(() => crypto.randomUUID()) } }
      : {}),
  });
}
