/**
 * Grep-stable stderr fragments for quota fallback / exhaustion shared by patch
 * (`jarvis run`) and plan (`jarvis plan`). Documented in docs/quota-signals.md.
 */
export const HARNESS_QUOTA_FALLBACK_STRICT = "quota exhausted; falling back";

export function harnessQuotaFallbackLenientLine(exitCode: number): string {
  return `probable quota-like error (exit ${exitCode}); falling back`;
}

export function harnessTransientRetryLine(exitCode: number, attempt: number, cap: number): string {
  return `transient transport error (exit ${exitCode}); retrying same agent (attempt ${attempt}/${cap})`;
}

/** Same phrase as in patch harness final exhaustion line (no trailing newline). */
export const HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED = "all agents quota-exhausted";
