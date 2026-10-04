import type { Usage } from "../prices/cost.ts";

export function codexNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/**
 * Maps codex token totals (`{input_tokens, cached_input_tokens, output_tokens}`, the shape of both a
 * rollout `total_token_usage` and an `exec --json` `turn.completed.usage`) to harness usage: the
 * cached share is split out of the input count.
 */
export function codexUsageFromTotals(totals: Record<string, unknown>): Usage {
  const input = codexNumberOrNull(totals.input_tokens);
  const cachedInput = codexNumberOrNull(totals.cached_input_tokens);
  const output = codexNumberOrNull(totals.output_tokens);
  const freshInput = input !== null ? (cachedInput !== null ? Math.max(0, input - cachedInput) : input) : null;
  return {
    input_tokens: freshInput,
    output_tokens: output,
    cache_read_input_tokens: cachedInput,
    cache_creation_input_tokens: null,
  };
}
