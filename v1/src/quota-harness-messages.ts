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

export function harnessGitGhTransientRetryLine(op: string, attempt: number, cap: number): string {
  return `${op}: transient network error; retrying (attempt ${attempt}/${cap})`;
}

/** Same phrase as in patch harness final exhaustion line (no trailing newline). */
export const HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED = "all agents quota-exhausted";

/** Emitted on stderr when no-progress escalates to the next agent (no trailing newline). */
export const HARNESS_NO_PROGRESS_FALLBACK = "no progress; escalating to next agent";

/** Emitted on stderr when idle-timeout escalates to the next agent (no trailing newline). */
export const HARNESS_IDLE_TIMEOUT_FALLBACK = "idle timeout; escalating to next agent";

/** Emitted on stderr when model configuration failure rotates to the next agent (no trailing newline). */
export const HARNESS_MODEL_CONFIG_FALLBACK = "model configuration error; falling back";

/** Emitted on stderr when auth failure rotates to the next agent, naming the agent needing re-auth (no trailing newline). */
export function harnessAuthRotateLine(agent: string): string {
  return `${agent} auth failed; re-authenticate and rerun`;
}

/** Emitted on stderr when an implementation-phase agent invocation produces zero observed output (no trailing newline). */
export function harnessZeroAgentOutputLine(agent: string): string {
  return `zero agent output observed from ${agent}; check agent binding`;
}
