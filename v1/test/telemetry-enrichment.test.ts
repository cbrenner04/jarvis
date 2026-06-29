import { describe, expect, test } from "bun:test";
import { extractUsageAndCost } from "../src/telemetry-enrichment.ts";

const usage100x50 = {
  input_tokens: 100,
  output_tokens: 50,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

const usage10x5 = {
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

describe("extractUsageAndCost: estimated usage", () => {
  test("agent-priced cursor model with usage_source=estimated yields cost_source=estimated", () => {
    // "Composer 2" exists in data/prices.json with null rates — computeCost
    // sees a row but no rates, returning cost_usd:0 and cost_source:no-price.
    const result = extractUsageAndCost(
      { usage_source: "estimated", usage: usage100x50 },
      "cursor",
      "Composer 2",
    );
    expect(result.usage_source).toBe("estimated");
    expect(result.cost_source).toBe("estimated");
    expect(result.usage?.input_tokens).toBe(100);
  });

  test("estimated cursor usage with an unknown cursor model yields no-price", () => {
    const result = extractUsageAndCost(
      { usage_source: "estimated", usage: usage10x5 },
      "cursor",
      "not-a-cursor-model",
    );
    expect(result.usage_source).toBe("estimated");
    expect(result.cost_source).toBe("no-price");
    expect(result.cost_usd).toBeNull();
  });

  test.each(["github-copilot/claude-opus-4.8", "opencode/glm-5.2"])(
    "estimated opencode usage with %s yields cost_source=estimated",
    (model) => {
      const result = extractUsageAndCost(
        { usage_source: "estimated", usage: usage100x50 },
        "opencode",
        model,
      );
      expect(result.usage_source).toBe("estimated");
      expect(result.cost_source).toBe("estimated");
      expect(result.cost_usd).toBeTypeOf("number");
    },
  );

  test("estimated opencode usage with an unknown model yields no-price", () => {
    const result = extractUsageAndCost(
      { usage_source: "estimated", usage: usage10x5 },
      "opencode",
      "not-a-priced-opencode-model",
    );
    expect(result.usage_source).toBe("estimated");
    expect(result.cost_source).toBe("no-price");
    expect(result.cost_usd).toBeNull();
  });

  test("agent-reported opencode usage without cost_usd yields cost_source=computed", () => {
    const result = extractUsageAndCost(
      { usage: usage100x50, cost_usd: null },
      "opencode",
      "opencode/glm-5.2",
    );
    expect(result.usage_source).toBe("agent");
    expect(result.cost_source).toBe("computed");
    expect(result.cost_usd).toBeTypeOf("number");
  });
});
