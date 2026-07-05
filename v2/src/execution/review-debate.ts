import { writeFileSync } from "node:fs";
import {
  executeWithQuotaFallback,
  type InvocationBinding,
  type InvocationExecution,
  type InvocationTelemetryContext,
} from "../../../shared/invocation/execute.ts";
import type { InvocationFailureKind } from "./invocation-failure.ts";

/** Fixed debate role order: adversary -> advocate -> adjudicator -> actuator. */
export type ReviewDebateRole = "adversary" | "advocate" | "adjudicator" | "actuator";

/**
 * Read-only-by-construction: callers must supply bindings whose `invoke` has
 * no write capability. A binding-contract convention, not a runtime sandbox
 * this type alone enforces.
 */
export type ReadOnlyInvocationBinding = InvocationBinding;

export type ReviewDebateRoleBindings = {
  adversary: readonly ReadOnlyInvocationBinding[];
  advocate: readonly ReadOnlyInvocationBinding[];
  adjudicator: readonly ReadOnlyInvocationBinding[];
  actuator: readonly InvocationBinding[];
};

/** Outcome for one review-debate cycle. */
export type ReviewDebateCycleOutcome = {
  roleResults: Partial<Record<ReviewDebateRole, InvocationExecution>>;
} & (
  | { kind: "completed"; verdict: string; actuatorRan: boolean }
  | { kind: "role_failed"; failedRole: ReviewDebateRole; failureKind: InvocationFailureKind; verdict: string | null }
);

export type ReviewDebateResult = {
  cycles: ReviewDebateCycleOutcome[];
};

/** Input for one review-debate run. Actuator's prompt is the settled verdict text, not caller-supplied. */
export type ReviewDebateInput = {
  cwd: string;
  prompts: { adversary: string; advocate: string; adjudicator: string };
  bindings: ReviewDebateRoleBindings;
  verdictPath: string;
  maxCycles: number;
  signal?: AbortSignal;
  telemetry?: Omit<InvocationTelemetryContext, "role" | "invocationIds">;
};

/**
 * Run up to `maxCycles` review-debate cycles: adversary -> advocate ->
 * adjudicator -> actuator. Each cycle writes the adjudicator's verdict to
 * `verdictPath`; an empty verdict skips the actuator and stops the loop.
 */
export async function executeReviewDebate(args: ReviewDebateInput): Promise<ReviewDebateResult> {
  const cycles: ReviewDebateCycleOutcome[] = [];

  for (let cycle = 0; cycle < args.maxCycles; cycle += 1) {
    const roleResults: Partial<Record<ReviewDebateRole, InvocationExecution>> = {};

    const adversary = await invokeRole(args, "adversary", args.prompts.adversary, args.bindings.adversary);
    roleResults.adversary = adversary;
    const adversaryFailure = failureKind(adversary);
    if (adversaryFailure !== null) {
      cycles.push({
        kind: "role_failed",
        failedRole: "adversary",
        failureKind: adversaryFailure,
        verdict: null,
        roleResults,
      });
      break;
    }

    const advocate = await invokeRole(args, "advocate", args.prompts.advocate, args.bindings.advocate);
    roleResults.advocate = advocate;
    const advocateFailure = failureKind(advocate);
    if (advocateFailure !== null) {
      cycles.push({
        kind: "role_failed",
        failedRole: "advocate",
        failureKind: advocateFailure,
        verdict: null,
        roleResults,
      });
      break;
    }

    const adjudicator = await invokeRole(args, "adjudicator", args.prompts.adjudicator, args.bindings.adjudicator);
    roleResults.adjudicator = adjudicator;
    if (adjudicator.final === null) {
      cycles.push({
        kind: "role_failed",
        failedRole: "adjudicator",
        failureKind: "no_binding",
        verdict: null,
        roleResults,
      });
      break;
    }
    if (adjudicator.final.result.kind !== "ok") {
      cycles.push({
        kind: "role_failed",
        failedRole: "adjudicator",
        failureKind: adjudicator.final.result.kind,
        verdict: null,
        roleResults,
      });
      break;
    }

    const verdict = adjudicator.final.result.stdout;
    writeFileSync(args.verdictPath, verdict, "utf8");

    if (verdict.trim().length === 0) {
      cycles.push({ kind: "completed", verdict, actuatorRan: false, roleResults });
      break;
    }

    const actuator = await invokeRole(args, "actuator", verdict, args.bindings.actuator);
    roleResults.actuator = actuator;
    const actuatorFailure = failureKind(actuator);
    if (actuatorFailure !== null) {
      cycles.push({ kind: "role_failed", failedRole: "actuator", failureKind: actuatorFailure, verdict, roleResults });
      break;
    }

    cycles.push({ kind: "completed", verdict, actuatorRan: true, roleResults });
  }

  return { cycles };
}

function failureKind(execution: InvocationExecution): InvocationFailureKind | null {
  if (execution.final === null) return "no_binding";
  return execution.final.result.kind === "ok" ? null : execution.final.result.kind;
}

async function invokeRole(
  args: ReviewDebateInput,
  role: ReviewDebateRole,
  prompt: string,
  bindings: readonly InvocationBinding[],
): Promise<InvocationExecution> {
  return executeWithQuotaFallback({
    prompt,
    cwd: args.cwd,
    bindings,
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
    ...(args.telemetry !== undefined
      ? {
          telemetry: {
            ...args.telemetry,
            role,
            invocationIds: bindings.map(() => crypto.randomUUID()),
          },
        }
      : {}),
  });
}
