import { writeFileSync } from "node:fs";
import type {
  InvocationBinding,
  InvocationOk,
  InvocationTelemetryContext,
} from "../../../shared/invocation/execute.ts";
import type { ReviewPromptProfile } from "../../../shared/prompts/review-profile.ts";
import type { InvocationFailureKind } from "./invocation-failure.ts";
import { cycleProfileContext } from "./review-profile-context.ts";
import { invokeReviewRole, reviewRoleFailureKind } from "./review-role-invocation.ts";

export type ReviewCycleRole = "critic" | "actuator";
type RoleExecution = Awaited<ReturnType<typeof invokeReviewRole>>;

/** Critic bindings are read-only by caller convention; the executor adds no sandbox. */
export type ReviewCycleRoleBindings = {
  critic: readonly InvocationBinding[];
  actuator: readonly InvocationBinding[];
};

export type ReviewCycleInput = {
  cwd: string;
  prompt?: string | (() => string);
  // biome-ignore lint/suspicious/noExplicitAny: profile context type determined at dispatch
  profile?: ReviewPromptProfile<any, any>;
  profileContext?: unknown;
  bindings: ReviewCycleRoleBindings;
  verdictPath: string;
  maxCycles: number;
  /** Wall clock per role invocation; defaults to the write-loop iteration timeout. */
  roleTimeoutMs?: number;
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
      roleResults: Partial<Record<ReviewCycleRole, RoleExecution>>;
    }
  | {
      kind: "role_failed";
      failedRole: ReviewCycleRole;
      failureKind: InvocationFailureKind;
      verdict: string | null;
      roleResults: Partial<Record<ReviewCycleRole, RoleExecution>>;
    }
  | {
      kind: "invocation_failure";
      failureKind: "error";
      verdict: string | null;
      roleResults: Partial<Record<ReviewCycleRole, RoleExecution>>;
    };

export type ReviewCycleResult =
  | { kind: "complete"; cycles: ReviewCycleOutcome[] }
  | {
      kind: "invocation_failure";
      failureKind: "error" | InvocationFailureKind;
      failedRole?: ReviewCycleRole;
      cycles: ReviewCycleOutcome[];
    };

/** Critic prompt for one cycle: the review profile's renderer, else the caller's literal prompt. */
async function resolveCriticPrompt(
  args: ReviewCycleInput,
  profileContext: Parameters<NonNullable<ReviewCycleInput["profile"]>["render"]["critic"]>[0],
): Promise<string> {
  if (args.profile) return await args.profile.render.critic(profileContext);
  return typeof args.prompt === "function" ? args.prompt() : (args.prompt ?? "");
}

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

    const roleResults: Partial<Record<ReviewCycleRole, RoleExecution>> = {};
    const profileContext = cycleProfileContext(args.profileContext, cycle + 1, cycles.at(-1)?.verdict ?? undefined);
    const criticPrompt = await resolveCriticPrompt(args, profileContext);
    const critic = await invokeReviewRole(args, "critic", criticPrompt, args.bindings.critic);
    roleResults.critic = critic;
    const criticFailure = reviewRoleFailureKind(critic);
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

    const actuatorPrompt = args.profile
      ? await args.profile.render.actuator(profileContext, verdict)
      : args.actuatorPromptRenderer
        ? args.actuatorPromptRenderer(verdict)
        : verdict;
    const actuator = await invokeReviewRole(args, "actuator", actuatorPrompt, args.bindings.actuator);
    roleResults.actuator = actuator;
    const actuatorFailure = reviewRoleFailureKind(actuator);
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
  roleResults: Partial<Record<ReviewCycleRole, RoleExecution>>,
): ReviewCycleOutcome {
  return { kind: "role_failed", failedRole, failureKind: failureKindValue, verdict, roleResults };
}
