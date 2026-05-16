import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { computeCost } from "../src/prices/cost.ts";
import { loadPrices } from "../src/prices/load.ts";

describe("loadPrices", () => {
  const tmpDir = ".test-prices";

  beforeAll(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads and validates prices from a valid file", () => {
    const file = join(tmpDir, "valid.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        models: {
          "test-model": {
            input_per_mtok: 1.0,
            output_per_mtok: 2.0,
            source_url: "https://example.com",
            as_of: "2026-05-15",
          },
        },
      }),
    );

    const prices = loadPrices(file);
    expect(prices.version).toBe(1);
    expect(prices.models["test-model"]).toBeDefined();
    const model = prices.models["test-model"];
    expect(model?.input_per_mtok).toBe(1.0);
    expect(model?.output_per_mtok).toBe(2.0);
  });

  it("rejects unknown version", () => {
    const file = join(tmpDir, "bad-version.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        models: {},
      }),
    );

    expect(() => loadPrices(file)).toThrow(/unknown version/);
  });

  it("rejects negative rate values", () => {
    const file = join(tmpDir, "negative-rate.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        models: {
          "test-model": {
            input_per_mtok: -1.0,
            output_per_mtok: 2.0,
            source_url: "https://example.com",
            as_of: "2026-05-15",
          },
        },
      }),
    );

    expect(() => loadPrices(file)).toThrow(/must be non-negative/);
  });

  it("rejects non-numeric rate values (except null)", () => {
    const file = join(tmpDir, "non-numeric-rate.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        models: {
          "test-model": {
            input_per_mtok: "not-a-number",
            output_per_mtok: 2.0,
            source_url: "https://example.com",
            as_of: "2026-05-15",
          },
        },
      }),
    );

    expect(() => loadPrices(file)).toThrow(/must be a number or null/);
  });

  it("accepts null rate values", () => {
    const file = join(tmpDir, "null-rates.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        models: {
          "cursor-default": {
            input_per_mtok: null,
            output_per_mtok: null,
            source_url: "https://example.com",
            as_of: "2026-05-15",
          },
        },
      }),
    );

    const prices = loadPrices(file);
    const model = prices.models["cursor-default"];
    expect(model?.input_per_mtok).toBeNull();
    expect(model?.output_per_mtok).toBeNull();
  });

  it("accepts and preserves manual and manual_note fields", () => {
    const file = join(tmpDir, "manual.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        models: {
          "cursor-default": {
            input_per_mtok: null,
            output_per_mtok: null,
            source_url: "https://example.com",
            as_of: "2026-05-15",
            manual: true,
            manual_note: "No published rates available.",
          },
        },
      }),
    );

    const prices = loadPrices(file);
    const model = prices.models["cursor-default"];
    expect(model?.manual).toBe(true);
    expect(model?.manual_note).toBe("No published rates available.");
  });

  it("rejects missing file", () => {
    expect(() => loadPrices(join(tmpDir, "nonexistent.json"))).toThrow(
      /Failed to read prices file/,
    );
  });

  it("rejects invalid JSON", () => {
    const file = join(tmpDir, "invalid.json");
    writeFileSync(file, "{ broken json");

    expect(() => loadPrices(file)).toThrow(/Invalid JSON/);
  });

  it("accepts unknown fields in price rows (forward-compat)", () => {
    const file = join(tmpDir, "unknown-fields.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        models: {
          "test-model": {
            input_per_mtok: 1.0,
            output_per_mtok: 2.0,
            source_url: "https://example.com",
            as_of: "2026-05-15",
            future_field: "some value",
            another_field: 42,
          },
        },
      }),
    );

    const prices = loadPrices(file);
    const row = prices.models["test-model"] as Record<string, unknown>;
    expect(row.future_field).toBe("some value");
    expect(row.another_field).toBe(42);
  });
});

describe("computeCost", () => {
  const prices = {
    version: 1,
    models: {
      "claude-sonnet-4-6": {
        input_per_mtok: 3.0,
        output_per_mtok: 15.0,
        cache_read_per_mtok: 0.3,
        cache_write_per_mtok: 3.75,
        source_url: "https://example.com",
        as_of: "2026-05-15",
      },
      "cursor-default": {
        input_per_mtok: null,
        output_per_mtok: null,
        source_url: "https://example.com",
        as_of: "2026-05-15",
      },
    },
  };

  it("computes cost with all four token buckets populated", () => {
    const usage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 100,
    };

    const result = computeCost(usage, "claude-sonnet-4-6", prices);
    expect(result.cost_source).toBe("computed");

    // (1000 * 3.0 + 500 * 15.0 + 200 * 0.3 + 100 * 3.75) / 1_000_000
    // = (3000 + 7500 + 60 + 375) / 1_000_000
    // = 10935 / 1_000_000
    // = 0.010935
    expect(result.cost_usd).toBe(0.010935);
  });

  it("applies cache-rate fallback to input_per_mtok", () => {
    const pricesWithoutCacheRates = {
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

    const result = computeCost(usage, "test-model", pricesWithoutCacheRates);

    // (100 * 2.0 + 100 * 10.0 + 100 * 2.0 + 100 * 2.0) / 1_000_000
    // = (200 + 1000 + 200 + 200) / 1_000_000
    // = 1600 / 1_000_000
    // = 0.0016
    expect(result.cost_source).toBe("computed");
    expect(result.cost_usd).toBe(0.0016);
  });

  it("returns no-price when model is missing", () => {
    const usage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };

    const result = computeCost(usage, "unknown-model", prices);
    expect(result.cost_source).toBe("no-price");
    expect(result.cost_usd).toBeNull();
  });

  it("returns no-usage when all token counts are null", () => {
    const usage = {
      input_tokens: null,
      output_tokens: null,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    };

    const result = computeCost(usage, "claude-sonnet-4-6", prices);
    expect(result.cost_source).toBe("no-usage");
    expect(result.cost_usd).toBeNull();
  });

  it("returns no-usage when usage is undefined", () => {
    const result = computeCost(undefined, "claude-sonnet-4-6", prices);
    expect(result.cost_source).toBe("no-usage");
    expect(result.cost_usd).toBeNull();
  });

  it("returns no-price when all rates are null (cursor case)", () => {
    const usage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };

    const result = computeCost(usage, "cursor-default", prices);
    expect(result.cost_source).toBe("no-price");
    expect(result.cost_usd).toBeNull();
  });

  it("treats null token counts as 0", () => {
    const usage = {
      input_tokens: 1000,
      output_tokens: null,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    };

    const result = computeCost(usage, "claude-sonnet-4-6", prices);
    expect(result.cost_source).toBe("computed");
    // (1000 * 3.0) / 1_000_000 = 0.003
    expect(result.cost_usd).toBe(0.003);
  });

  it("handles zero cost correctly", () => {
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };

    const result = computeCost(usage, "claude-sonnet-4-6", prices);
    expect(result.cost_source).toBe("computed");
    expect(result.cost_usd).toBe(0);
  });
});

describe("telemetry integration", () => {
  it("accepts records with and without new fields", async () => {
    const { appendTelemetryLine } = await import("../src/telemetry.ts");
    const tmpDir = ".test-telemetry";
    mkdirSync(tmpDir, { recursive: true });

    try {
      const oldStyleRecord = {
        ts: "2026-05-16T12:00:00Z",
        namespace: "test",
        agent: "claude",
        iteration: 1,
        duration_ms: 1000,
        kind: "ok" as const,
        exit_reason: "success",
      };

      const telemetryPath = join(tmpDir, "test.jsonl");
      appendTelemetryLine(telemetryPath, oldStyleRecord);

      // Verify it was written
      const { readFileSync } = await import("node:fs");
      const content = readFileSync(telemetryPath, "utf8");
      const lines = content.trim().split("\n");
      const line = lines[0];
      if (line === undefined) {
        throw new Error("Expected at least one line in telemetry file");
      }
      const parsed = JSON.parse(line);

      expect(parsed.ts).toBe("2026-05-16T12:00:00Z");
      expect(parsed.agent).toBe("claude");
      expect(parsed.usage).toBeUndefined();
      expect(parsed.cost_usd).toBeUndefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("preserves new fields when present", async () => {
    const { appendTelemetryLine } = await import("../src/telemetry.ts");
    const tmpDir = ".test-telemetry-new";
    mkdirSync(tmpDir, { recursive: true });

    try {
      const newStyleRecord = {
        ts: "2026-05-16T12:00:00Z",
        namespace: "test",
        agent: "claude",
        iteration: 1,
        duration_ms: 1000,
        kind: "ok" as const,
        exit_reason: "success",
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        usage_source: "agent" as const,
        cost_usd: 0.0045,
        cost_source: "computed" as const,
      };

      const telemetryPath = join(tmpDir, "test.jsonl");
      appendTelemetryLine(telemetryPath, newStyleRecord);

      // Verify it was written correctly
      const { readFileSync } = await import("node:fs");
      const content = readFileSync(telemetryPath, "utf8");
      const lines = content.trim().split("\n");
      const line = lines[0];
      if (line === undefined) {
        throw new Error("Expected at least one line in telemetry file");
      }
      const parsed = JSON.parse(line);

      expect(parsed.usage).toBeDefined();
      expect(parsed.usage.input_tokens).toBe(1000);
      expect(parsed.usage.output_tokens).toBe(500);
      expect(parsed.cost_usd).toBe(0.0045);
      expect(parsed.cost_source).toBe("computed");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("serializes null values correctly", async () => {
    const { appendTelemetryLine } = await import("../src/telemetry.ts");
    const tmpDir = ".test-telemetry-null";
    mkdirSync(tmpDir, { recursive: true });

    try {
      const recordWithNulls = {
        ts: "2026-05-16T12:00:00Z",
        namespace: "test",
        agent: "claude",
        iteration: 1,
        duration_ms: 1000,
        kind: "ok" as const,
        exit_reason: "success",
        usage: {
          input_tokens: null,
          output_tokens: null,
          cache_read_input_tokens: null,
          cache_creation_input_tokens: null,
        },
        usage_source: "unavailable" as const,
        cost_usd: null,
        cost_source: "no-usage" as const,
      };

      const telemetryPath = join(tmpDir, "test.jsonl");
      appendTelemetryLine(telemetryPath, recordWithNulls);

      // Verify it was written correctly
      const { readFileSync } = await import("node:fs");
      const content = readFileSync(telemetryPath, "utf8");
      const lines = content.trim().split("\n");
      const line = lines[0];
      if (line === undefined) {
        throw new Error("Expected at least one line in telemetry file");
      }
      const parsed = JSON.parse(line);

      expect(parsed.cost_usd).toBeNull();
      expect(parsed.cost_source).toBe("no-usage");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
