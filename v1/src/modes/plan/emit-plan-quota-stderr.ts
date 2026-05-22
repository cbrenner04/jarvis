import type { AgentResult } from "../../agents/types.ts";
import type { AgentName } from "../../config.ts";
import {
  HARNESS_QUOTA_FALLBACK_STRICT,
  harnessQuotaFallbackLenientLine,
} from "../../quota-harness-messages.ts";

/**
 * When plan rotates to the next agent after a quota-classified result, print a
 * line aligned with patch harness wording (see docs/quota-signals.md).
 */
export function emitPlanAgentQuotaFallback(
  stderrFn: ((s: string) => void) | undefined,
  agent: AgentName,
  spawnResult: AgentResult,
  classified: AgentResult,
): void {
  if (stderrFn === undefined || classified.kind !== "quota") return;
  if (spawnResult.kind === "quota") {
    stderrFn(`plan: ${agent}: ${HARNESS_QUOTA_FALLBACK_STRICT}\n`);
    return;
  }
  if (spawnResult.kind === "error") {
    stderrFn(
      `plan: ${agent}: ${harnessQuotaFallbackLenientLine(spawnResult.exitCode)}\n`,
    );
  }
}
