import { describe, expect, it } from "bun:test";

import { computeCost } from "./cost.ts";
import { loadPrices } from "./load.ts";

/** Token counts from a real cursor terminal frame (v2/spec/seeds/cursor-usage-is-parsed-then-discarded.md). */
export const COMPOSER_25_FIXTURE_USAGE = {
  input_tokens: 4023,
  output_tokens: 27,
  cache_read_input_tokens: 8851,
  cache_creation_input_tokens: 0,
};

describe("computeCost", () => {
  it("pins Composer 2.5 cost against checked-in catalog rates", () => {
    // Guard-inversion checkpoint: omitting cache_read_input_tokens from the sum should turn this RED.
    const result = computeCost(COMPOSER_25_FIXTURE_USAGE, "Composer 2.5", loadPrices());
    expect(result.cost_source).toBe("computed");
    expect(result.cost_usd).toBeCloseTo(0.0038492, 10);
  });

  it("returns no-price for unknown priceKey", () => {
    const result = computeCost(COMPOSER_25_FIXTURE_USAGE, "unknown-price-key", loadPrices());
    expect(result.cost_source).toBe("no-price");
    expect(result.cost_usd).toBeNull();
  });

  it("returns no-usage when usage is undefined", () => {
    const result = computeCost(undefined, "Composer 2.5", loadPrices());
    expect(result.cost_source).toBe("no-usage");
    expect(result.cost_usd).toBeNull();
  });

  it("returns no-usage when all token counts are null", () => {
    const usage = {
      input_tokens: null,
      output_tokens: null,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    };

    const result = computeCost(usage, "Composer 2.5", loadPrices());
    expect(result.cost_source).toBe("no-usage");
    expect(result.cost_usd).toBeNull();
  });

  it("returns no-price when all rates are null", () => {
    const prices = {
      version: 1,
      models: {
        "cursor-default": {
          input_per_mtok: null,
          output_per_mtok: null,
          source_url: "https://example.com",
          as_of: "2026-05-15",
        },
      },
    };

    const result = computeCost(COMPOSER_25_FIXTURE_USAGE, "cursor-default", prices);
    expect(result.cost_source).toBe("no-price");
    expect(result.cost_usd).toBeNull();
  });

  it("returns computed with zero cost when all token counts are zero", () => {
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };

    const result = computeCost(usage, "Composer 2.5", loadPrices());
    expect(result.cost_source).toBe("computed");
    expect(result.cost_usd).toBe(0);
  });

  it("falls back cache rates to input_per_mtok when cache columns are absent", () => {
    const prices = {
      version: 1,
      models: {
        "test-model": {
          input_per_mtok: 2.0,
          output_per_mtok: 10.0,
          source_url: "https://example.com",
          as_of: "2026-05-15",
        },
      },
    };

    const usage = {
      input_tokens: 100,
      output_tokens: 100,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 100,
    };

    const result = computeCost(usage, "test-model", prices);

    // (100 * 2.0 + 100 * 10.0 + 100 * 2.0 + 100 * 2.0) / 1_000_000 = 0.0016
    expect(result.cost_source).toBe("computed");
    expect(result.cost_usd).toBe(0.0016);
  });
});
