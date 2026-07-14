import { writeFileSync } from "node:fs";
import {
  executeWithQuotaFallback,
  type InvocationBinding,
  type InvocationExecution,
  type InvocationOk,
  type InvocationTelemetryContext,
} from "../../../shared/invocation/execute.ts";
import type { InvocationFailureKind } from "./invocation-failure.ts";
import type { ReviewPromptProfile } from "../../../shared/prompts/review-profile.ts";

/** Fixed debate role order: adversary -> advocate -> adjudicator -> actuator. */
export type ReviewDebateRole = "adversary" | "advocate" | "adjudicator" | "actuator";

/**
 * Read-only-by-construction: callers must supply `adversary`/`advocate`/`adjudicator`
 * bindings whose `invoke` has no write capability. A binding-contract convention,
 * not a runtime sandbox this type alone enforces.
 */
export type ReviewDebateRoleBindings = {
  adversary: readonly InvocationBinding[];
  advocate: readonly InvocationBinding[];
  adjudicator: readonly InvocationBinding[];
  actuator: readonly InvocationBinding[];
};

type ReviewDebateCycleOutcome = {
  roleResults: Partial<Record<ReviewDebateRole, InvocationExecution>>;
} & (
  | { kind: "completed"; verdict: string; actuatorRan: boolean }
  | { kind: "role_failed"; failedRole: ReviewDebateRole; failureKind: InvocationFailureKind; verdict: string | null }
);

type ReviewDebateResult = {
  cycles: ReviewDebateCycleOutcome[];
};

/** Input for one review-debate run. Actuator's prompt is the settled verdict text, not caller-supplied. */
export type ReviewDebateInput = {
  cwd: string;
  prompts?: { adversary: string; advocate: string; adjudicator: string };
  profile?: ReviewPromptProfile<any, any>;
  profileContext?: unknown;
  bindings: ReviewDebateRoleBindings;
  verdictPath: string;
  maxCycles: number;
  signal?: AbortSignal;
  telemetry?: Omit<InvocationTelemetryContext, "role" | "invocationIds">;
  /** Called just before each role's invocation starts, in debate order, once per cycle. */
  onRoleStart?: (role: ReviewDebateRole) => void;
};

/**
 * Run up to `maxCycles` review-debate cycles: adversary -> advocate ->
 * adjudicator -> actuator. Each cycle writes the adjudicator's verdict to
 * `verdictPath`; an empty verdict skips the actuator and stops the loop.
 */
export async function executeReviewDebate(args: ReviewDebateInput): Promise<ReviewDebateResult> {
  if (!Number.isFinite(args.maxCycles) || !Number.isInteger(args.maxCycles) || args.maxCycles < 0) {
    throw new RangeError("maxCycles must be a finite non-negative integer");
  }

  const cycles: ReviewDebateCycleOutcome[] = [];

  for (let cycle = 0; cycle < args.maxCycles; cycle += 1) {
    const roleResults: Partial<Record<ReviewDebateRole, InvocationExecution>> = {};
    const profileContext = typeof args.profileContext === "function" ? args.profileContext(cycle + 1, cycles.at(-1)?.verdict) : args.profileContext;

    const adversary = await invokeRole(
      args,
      "adversary",
      args.profile?.render.debateRole
        ? await args.profile.render.debateRole("adversary", profileContext)
        : args.prompts?.adversary ?? "",
      args.bindings.adversary,
    );
    roleResults.adversary = adversary;
    const adversaryFailure = failureKind(adversary);
    if (adversaryFailure !== null) {
      cycles.push(roleFailedOutcome("adversary", adversaryFailure, null, roleResults));
      break;
    }

    const advocate = await invokeRole(
      args,
      "advocate",
      args.profile?.render.debateRole
        ? await args.profile.render.debateRole("advocate", profileContext, (adversary.final?.result as InvocationOk).stdout)
        : args.prompts?.advocate ?? "",
      args.bindings.advocate,
    );
    roleResults.advocate = advocate;
    const advocateFailure = failureKind(advocate);
    if (advocateFailure !== null) {
      cycles.push(roleFailedOutcome("advocate", advocateFailure, null, roleResults));
      break;
    }

    const adjudicator = await invokeRole(
      args,
      "adjudicator",
      args.profile?.render.debateRole
        ? await args.profile.render.debateRole("adjudicator", profileContext, (advocate.final?.result as InvocationOk).stdout)
        : args.prompts?.adjudicator ?? "",
      args.bindings.adjudicator,
    );
    roleResults.adjudicator = adjudicator;
    const adjudicatorFailure = failureKind(adjudicator);
    if (adjudicatorFailure !== null) {
      cycles.push(roleFailedOutcome("adjudicator", adjudicatorFailure, null, roleResults));
      break;
    }

    const adjudicatorFinal = adjudicator.final;
    if (adjudicatorFinal === null) throw new Error("unreachable: adjudicator failure already handled above");
    const verdict = (adjudicatorFinal.result as InvocationOk).stdout;
    writeFileSync(args.verdictPath, verdict, "utf8");

    if (verdict.trim().length === 0) {
      cycles.push({ kind: "completed", verdict, actuatorRan: false, roleResults });
      break;
    }

    const actuator = await invokeRole(
      args,
      "actuator",
      args.profile?.render.actuator ? await args.profile.render.actuator(profileContext, verdict) : verdict,
      args.bindings.actuator,
    );
    roleResults.actuator = actuator;
    const actuatorFailure = failureKind(actuator);
    if (actuatorFailure !== null) {
      cycles.push(roleFailedOutcome("actuator", actuatorFailure, verdict, roleResults));
      break;
    }

    cycles.push({ kind: "completed", verdict, actuatorRan: true, roleResults });
  }

  return { cycles };
}

function roleFailedOutcome(
  failedRole: ReviewDebateRole,
  failureKindValue: InvocationFailureKind,
  verdict: string | null,
  roleResults: Partial<Record<ReviewDebateRole, InvocationExecution>>,
): ReviewDebateCycleOutcome {
  return { kind: "role_failed", failedRole, failureKind: failureKindValue, verdict, roleResults };
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
  args.onRoleStart?.(role);
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
