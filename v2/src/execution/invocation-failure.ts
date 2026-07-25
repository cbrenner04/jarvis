import type { InvocationResult } from "../../../shared/invocation/execute.ts";

/** Terminal binding-chain stop cause from `runStep` when `kind === "invocation_failure"`. */
export type InvocationFailureKind = "quota" | "stall" | "model_config" | "error" | "no_binding" | "landing" | "timeout";

/**
 * One binding attempt in chain order; `resultKind` is that attempt's `InvocationResult.kind`,
 * except `"timeout"` which marks a rung consumed by a role wall-clock overrun (not a raw
 * `InvocationResult` variant).
 */
export type BindingAttemptSummary = {
  bindingId: string;
  resultKind: InvocationResult["kind"] | "timeout";
  agent?: string;
  model?: string;
};

/** Persisted and operator-visible detail for binding-chain `invocation_failure` only. */
export type InvocationFailureDetail = {
  failureKind: InvocationFailureKind;
  bindingAttempts: BindingAttemptSummary[];
  /** Underlying error text, when the failure carries one (e.g. `landing`). */
  message?: string;
  role?: string;
  agent?: string;
  model?: string;
  boundMs?: number;
  /** `true` when a `failureKind: "timeout"` settled after every configured rung timed out. */
  exhaustedRoleTimeout?: boolean;
};

/** Terminal, non-retryable `failureKind: "timeout"` — every configured rung timed out. */
export function isExhaustedRoleTimeout(
  detail: Pick<InvocationFailureDetail, "failureKind" | "exhaustedRoleTimeout">,
): boolean {
  return detail.failureKind === "timeout" && detail.exhaustedRoleTimeout === true;
}
