import type { AgentResult } from "../../agents/types.ts";
import type { AgentName } from "../../config.ts";
import {
  HARNESS_MODEL_CONFIG_FALLBACK,
  HARNESS_QUOTA_FALLBACK_STRICT,
  harnessAuthRotateLine,
  harnessQuotaFallbackLenientLine,
} from "../../quota-harness-messages.ts";

type PlanRotationKind = "draft" | "intent" | "quota";

/**
 * When plan or intent inner loops rotate to the next agent after a
 * quota- or model_config-classified result, print a line aligned with patch
 * harness wording (see docs/quota-signals.md).
 */
export function emitPlanAgentQuotaFallback(
  stderrFn: ((s: string) => void) | undefined,
  agent: AgentName,
  spawnResult: AgentResult,
  classified: AgentResult,
  rotation: PlanRotationKind = "quota",
): void {
  if (stderrFn === undefined) return;

  const prefix = rotation === "intent" ? "intent" : "plan";

  if (classified.kind === "model_config" && rotation !== "quota") {
    stderrFn(`${prefix}: ${agent}: ${HARNESS_MODEL_CONFIG_FALLBACK}\n`);
    if (spawnResult.stderr.length > 0) {
      stderrFn(spawnResult.stderr.endsWith("\n") ? spawnResult.stderr : `${spawnResult.stderr}\n`);
    }
    return;
  }

  if (classified.kind !== "quota") return;
  if (spawnResult.kind === "quota") {
    if (spawnResult.authFailure === true) {
      stderrFn(`${prefix}: ${agent}: ${harnessAuthRotateLine(agent)}\n`);
    } else {
      stderrFn(`${prefix}: ${agent}: ${HARNESS_QUOTA_FALLBACK_STRICT}\n`);
    }
    return;
  }
  if (spawnResult.kind === "error") {
    stderrFn(`${prefix}: ${agent}: ${harnessQuotaFallbackLenientLine(spawnResult.exitCode)}\n`);
  }
}
