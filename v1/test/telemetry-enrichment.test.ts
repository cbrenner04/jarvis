import { describe, expect, test } from "bun:test";
import { extractUsageAndCost } from "../src/telemetry-enrichment.ts";

describe("extractUsageAndCost: estimated usage", () => {
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

  test("estimated opencode usage with a priced configured model yields cost_source=estimated", () => {
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
      "opencode",
      "github-copilot/claude-opus-4.8",
    );
    expect(result.usage_source).toBe("estimated");
    expect(result.cost_source).toBe("estimated");
    expect(result.cost_usd).toBeTypeOf("number");
  });

  test("estimated opencode usage with an unknown model yields no-price", () => {
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
      "opencode",
      "not-a-priced-opencode-model",
    );
    expect(result.usage_source).toBe("estimated");
    expect(result.cost_source).toBe("no-price");
    expect(result.cost_usd).toBeNull();
  });

  test("estimated aider usage always yields no-price because aider has no price key", () => {
    const result = extractUsageAndCost(
      {
        usage_source: "estimated",
        usage: {
          input_tokens: 42,
          output_tokens: 21,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
      "aider",
      "ollama_chat/qwen3.6:35b",
    );
    expect(result.usage_source).toBe("estimated");
    expect(result.cost_source).toBe("no-price");
    expect(result.cost_usd).toBeNull();
  });
});
