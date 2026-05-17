import { resolveAgentPriceKey } from "./agents/price-keys.ts";
import type { AgentName } from "./agents/types.ts";
import { computeCost } from "./prices/cost.ts";
import { loadPrices } from "./prices/load.ts";
import type { CostSource, UsageSource } from "./telemetry.ts";

export type UsageCostFields = {
  usage?: {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_input_tokens: number | null;
    cache_creation_input_tokens: number | null;
  };
  usage_source?: UsageSource;
  cost_usd?: number | null;
  cost_source?: CostSource;
};

/**
 * Normalize agent `ok` results into telemetry usage/cost fields, computing
 * missing USD cost from the price table when usage is present (patch + plan).
 */
export function extractUsageAndCost(
  result: {
    usage_source?: "agent" | "estimated" | "unavailable";
    usage?: {
      input_tokens: number | null;
      output_tokens: number | null;
      cache_read_input_tokens: number | null;
      cache_creation_input_tokens: number | null;
    };
    cost_usd?: number | null;
  },
  agent: AgentName,
  configuredModel: string | undefined,
): UsageCostFields {
  const priceKey = resolveAgentPriceKey(agent, configuredModel);
  const output: UsageCostFields = {};
  if (result.usage_source === "unavailable") {
    output.usage = {
      input_tokens: null,
      output_tokens: null,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    };
    output.usage_source = "unavailable";
    output.cost_usd = null;
    output.cost_source = "no-usage";
    return output;
  }

  if (result.cost_usd !== undefined && result.cost_usd !== null) {
    if (result.usage !== undefined) {
      output.usage = result.usage;
      output.usage_source = "agent";
    }
    output.cost_usd = result.cost_usd;
    output.cost_source = "agent";
    return output;
  }

  if (result.usage !== undefined) {
    const isEstimated = result.usage_source === "estimated";
    output.usage = result.usage;
    output.usage_source = isEstimated ? "estimated" : "agent";
    if (priceKey === null) {
      output.cost_usd = null;
      output.cost_source = "no-price";
    } else {
      try {
        const prices = loadPrices();
        const computedCost = computeCost(result.usage, priceKey, prices);
        output.cost_usd = computedCost.cost_usd;
        if (isEstimated && computedCost.cost_source === "computed") {
          output.cost_source = "estimated";
        } else if (computedCost.cost_source !== null) {
          output.cost_source = computedCost.cost_source;
        }
      } catch {
        // If price loading fails, leave usage without inferred cost fields.
      }
    }
    return output;
  }

  return output;
}
