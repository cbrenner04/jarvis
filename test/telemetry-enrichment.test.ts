import { describe, expect, test } from "bun:test";
import { extractUsageAndCost } from "../src/telemetry-enrichment.ts";

describe("extractUsageAndCost: estimated cursor usage", () => {
  test("agent-priced cursor model with usage_source=estimated yields cost_source=estimated", () => {
    // "Composer 2" exists in data/prices.json with null rates — computeCost
    // sees a row but no rates, returning cost_usd:0 and cost_source:no-price.
    const result = extractUsageAndCost(
      {
        usage_source: "estimated",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
      "cursor",
      "Composer 2",
    );
    expect(result.usage_source).toBe("estimated");
    expect(result.cost_source).toBe("estimated");
    expect(result.usage?.input_tokens).toBe(100);
  });

  test("estimated cursor usage with an unknown cursor model yields no-price", () => {
    const result = extractUsageAndCost(
      {
        usage_source: "estimated",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
      "cursor",
      "not-a-cursor-model",
    );
    expect(result.usage_source).toBe("estimated");
    expect(result.cost_source).toBe("no-price");
    expect(result.cost_usd).toBeNull();
  });
});
