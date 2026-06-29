import type { InvocationExecution, InvocationResult } from "../../shared/invocation/execute.ts";
import type { StepRunResult } from "./step-runner.ts";

/** Terminal binding-chain stop cause from `runStep` when `kind === "invocation_failure"`. */
export type InvocationFailureKind = "quota" | "model_config" | "error" | "no_binding";

/** One binding attempt in chain order; `resultKind` is that attempt's `InvocationResult.kind`. */
export type BindingAttemptSummary = {
  bindingId: string;
  resultKind: InvocationResult["kind"];
};

/** Persisted and operator-visible detail for binding-chain `invocation_failure` only. */
export type InvocationFailureDetail = {
  failureKind: InvocationFailureKind;
  bindingAttempts: BindingAttemptSummary[];
};

/** Summarize invocation attempts for durable state and foreground JSON. */
export function bindingAttemptsFromInvocation(
  invocation: InvocationExecution,
): BindingAttemptSummary[] {
  return invocation.attempts.map((attempt) => ({
    bindingId: attempt.binding.id,
    resultKind: attempt.result.kind,
  }));
}

/** Build detail from a binding-chain step failure. */
export function invocationFailureDetailFromStepResult(
  result: Extract<StepRunResult, { kind: "invocation_failure" }>,
): InvocationFailureDetail {
  return {
    failureKind: result.failureKind,
    bindingAttempts: bindingAttemptsFromInvocation(result.invocation),
  };
}
