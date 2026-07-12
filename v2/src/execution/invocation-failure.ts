import type { InvocationResult } from "../../../shared/invocation/execute.ts";

/** Terminal binding-chain stop cause from `runStep` when `kind === "invocation_failure"`. */
export type InvocationFailureKind = "quota" | "model_config" | "error" | "no_binding" | "landing";

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
