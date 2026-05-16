import type { CostSource, TelemetryUsage } from "../telemetry.ts";
import type { Prices } from "./load.ts";

export function computeCost(
  usage: TelemetryUsage | undefined,
  modelId: string,
  prices: Prices,
): { cost_usd: number | null; cost_source: CostSource } {
  // Check if model exists in prices
  const row = prices.models[modelId];
  if (row === undefined) {
    return { cost_usd: null, cost_source: "no-price" };
  }

  // If no usage data provided, return no-usage
  if (
    usage === undefined ||
    (usage.input_tokens === null &&
      usage.output_tokens === null &&
      usage.cache_read_input_tokens === null &&
      usage.cache_creation_input_tokens === null)
  ) {
    return { cost_usd: null, cost_source: "no-usage" };
  }

  // Compute cost from tokens and rates
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const cacheReadTokens = usage?.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage?.cache_creation_input_tokens ?? 0;

  const inputRate = row.input_per_mtok ?? 0;
  const outputRate = row.output_per_mtok ?? 0;
  const cacheReadRate = row.cache_read_per_mtok ?? row.input_per_mtok ?? 0;
  const cacheWriteRate = row.cache_write_per_mtok ?? row.input_per_mtok ?? 0;

  const totalCost =
    (inputTokens * inputRate +
      outputTokens * outputRate +
      cacheReadTokens * cacheReadRate +
      cacheWriteTokens * cacheWriteRate) /
    1_000_000;

  // Determine cost source: if all rates were null/undefined, we have no-price
  // Otherwise we computed the cost
  const hasAnyRate =
    (row.input_per_mtok !== null && row.input_per_mtok !== undefined) ||
    (row.output_per_mtok !== null && row.output_per_mtok !== undefined) ||
    (row.cache_read_per_mtok !== null &&
      row.cache_read_per_mtok !== undefined) ||
    (row.cache_write_per_mtok !== null &&
      row.cache_write_per_mtok !== undefined);

  return {
    cost_usd: totalCost > 0 || hasAnyRate ? totalCost : null,
    cost_source: hasAnyRate ? "computed" : "no-price",
  };
}
