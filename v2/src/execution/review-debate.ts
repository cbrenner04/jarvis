import { writeFileSync } from "node:fs";
import type { InvocationBinding, InvocationOk, InvocationTelemetryContext } from "../../../shared/invocation/execute.ts";
import type { ReviewPromptProfile } from "../../../shared/prompts/review-profile.ts";
import type { InvocationFailureKind } from "./invocation-failure.ts";
import { cycleProfileContext } from "./review-profile-context.ts";
import { invokeReviewRole, reviewRoleFailureKind } from "./review-role-invocation.ts";

/** Fixed debate role order: adversary -> advocate -> adjudicator -> actuator. */
export type ReviewDebateRole = "adversary" | "advocate" | "adjudicator" | "actuator";
type RoleExecution = Awaited<ReturnType<typeof invokeReviewRole>>;

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
  roleResults: Partial<Record<ReviewDebateRole, RoleExecution>>;
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
  // biome-ignore lint/suspicious/noExplicitAny: profile context type determined at dispatch
  profile?: ReviewPromptProfile<any, any>;
  profileContext?: unknown;
  bindings: ReviewDebateRoleBindings;
  verdictPath: string;
  maxCycles: number;
  /** Wall clock per role invocation; defaults to the write-loop iteration timeout. */
  roleTimeoutMs?: number;
  signal?: AbortSignal;
  telemetry?: Omit<InvocationTelemetryContext, "role" | "invocationIds">;
  /** Called just before each role's invocation starts, in debate order, once per cycle. */
  onRoleStart?: (role: ReviewDebateRole) => void;
};

/**
 * Prompt for one debate role: the profile's renderer, else the caller's literal prompt for
 * that role. `priorStdout` carries the preceding role's output to the renderer.
 */
async function debateRolePrompt(
  args: ReviewDebateInput,
  role: "adversary" | "advocate" | "adjudicator",
  profileContext: Parameters<NonNullable<NonNullable<ReviewDebateInput["profile"]>["render"]["debateRole"]>>[1],
  priorStdout?: string,
): Promise<string> {
  const render = args.profile?.render.debateRole;
  if (render) return await render(role, profileContext, priorStdout);
  return args.prompts?.[role] ?? "";
}

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
    const roleResults: Partial<Record<ReviewDebateRole, RoleExecution>> = {};
    const profileContext = cycleProfileContext(args.profileContext, cycle + 1, cycles.at(-1)?.verdict ?? undefined);

    const adversary = await invokeReviewRole(
      args,
      "adversary",
      await debateRolePrompt(args, "adversary", profileContext),
      args.bindings.adversary,
    );
    roleResults.adversary = adversary;
    const adversaryFailure = reviewRoleFailureKind(adversary);
    if (adversaryFailure !== null) {
      cycles.push(roleFailedOutcome("adversary", adversaryFailure, null, roleResults));
      break;
    }

    const advocate = await invokeReviewRole(
      args,
      "advocate",
      await debateRolePrompt(args, "advocate", profileContext, (adversary.final?.result as InvocationOk).stdout),
      args.bindings.advocate,
    );
    roleResults.advocate = advocate;
    const advocateFailure = reviewRoleFailureKind(advocate);
    if (advocateFailure !== null) {
      cycles.push(roleFailedOutcome("advocate", advocateFailure, null, roleResults));
      break;
    }

    const adjudicator = await invokeReviewRole(
      args,
      "adjudicator",
      await debateRolePrompt(args, "adjudicator", profileContext, (advocate.final?.result as InvocationOk).stdout),
      args.bindings.adjudicator,
    );
    roleResults.adjudicator = adjudicator;
    const adjudicatorFailure = reviewRoleFailureKind(adjudicator);
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

    const actuator = await invokeReviewRole(
      args,
      "actuator",
      args.profile?.render.actuator ? await args.profile.render.actuator(profileContext, verdict) : verdict,
      args.bindings.actuator,
    );
    roleResults.actuator = actuator;
    const actuatorFailure = reviewRoleFailureKind(actuator);
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
  roleResults: Partial<Record<ReviewDebateRole, RoleExecution>>,
): ReviewDebateCycleOutcome {
  return { kind: "role_failed", failedRole, failureKind: failureKindValue, verdict, roleResults };
}
