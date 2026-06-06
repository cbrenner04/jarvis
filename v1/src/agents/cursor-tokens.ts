import { type EstimatedTokenUsage, estimateTokenUsage } from "./token-estimation.ts";

export type EstimatedCursorUsage = EstimatedTokenUsage;

/**
 * Estimate cursor usage from what we control: the prompt we sent and the
 * stdout captured from the CLI. Cursor does not return usage; this is an
 * approximation labeled as "estimated" throughout the pipeline.
 *
 * Returns null on tokenizer failure; callers should fall back to
 * usage_source: "unavailable" in that case.
 */
export function estimateCursorUsage(args: { prompt: string; stdout: string }): EstimatedCursorUsage | null {
  return estimateTokenUsage(args);
}
