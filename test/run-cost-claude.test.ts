import { describe, expect, test } from "bun:test";
import { computeCost } from "../src/prices/cost.ts";
import { loadPrices } from "../src/prices/load.ts";

describe("cost computation for Claude", () => {
  test("computes cost from usage tokens", () => {
    const prices = loadPrices();

    const usage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };

    const result = computeCost(usage, "claude-haiku-4-5-20251001", prices);

    expect(result.cost_source).toBe("computed");
    expect(result.cost_usd).toBeGreaterThan(0);
  });

  test("returns no-price for unknown model", () => {
    const prices = loadPrices();

    const usage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };

    const result = computeCost(usage, "unknown-model-xyz", prices);

    expect(result.cost_source).toBe("no-price");
    expect(result.cost_usd).toBeNull();
  });

  test("returns no-usage when usage is undefined", () => {
    const prices = loadPrices();

    const result = computeCost(undefined, "claude-haiku-4-5-20251001", prices);

    expect(result.cost_source).toBe("no-usage");
    expect(result.cost_usd).toBeNull();
  });

  test("returns no-usage when all token counts are null", () => {
    const prices = loadPrices();

    const usage = {
      input_tokens: null,
      output_tokens: null,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    };

    const result = computeCost(usage, "claude-haiku-4-5-20251001", prices);

    expect(result.cost_source).toBe("no-usage");
    expect(result.cost_usd).toBeNull();
  });

  test("accounts for cache read tokens", () => {
    const prices = loadPrices();

    const usage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 0,
    };

    const result = computeCost(usage, "claude-haiku-4-5-20251001", prices);

    expect(result.cost_source).toBe("computed");
    // Cache read tokens should be cheaper than regular input tokens
    expect(result.cost_usd).toBeGreaterThan(0);
  });
});
