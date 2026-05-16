import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelsDevResponse } from "../src/prices/fetch.ts";
import type { Prices } from "../src/prices/load.ts";
import { runPricesUpdate } from "../src/prices/update.ts";

describe("prices update", () => {
  let tmpDir: string;
  let pricesPath: string;

  beforeEach(() => {
    const baseDir = process.env.TMPDIR || "/tmp";
    tmpDir = mkdtempSync(join(baseDir, "jarvis-test-"));
    pricesPath = join(tmpDir, "prices.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writePrices(models: Record<string, unknown>): void {
    const content = `${JSON.stringify(
      {
        version: 1,
        models,
      },
      null,
      2,
    )}\n`;
    writeFileSync(pricesPath, content, "utf8");
  }

  function readPrices(): Prices {
    const content = readFileSync(pricesPath, "utf8");
    return JSON.parse(content) as Prices;
  }

  it("happy path: updates rates for known models and reports unchanged/missing", async () => {
    writePrices({
      "claude-opus-4-7": {
        input_per_mtok: 15.0,
        output_per_mtok: 75.0,
        cache_read_per_mtok: 1.5,
        cache_write_per_mtok: 18.75,
        source_url: "https://www.anthropic.com/pricing",
        as_of: "2026-05-15",
      },
      "claude-sonnet-4-6": {
        input_per_mtok: 3.0,
        output_per_mtok: 15.0,
        cache_read_per_mtok: 0.3,
        cache_write_per_mtok: 3.75,
        source_url: "https://www.anthropic.com/pricing",
        as_of: "2026-05-15",
      },
      "claude-haiku-4-5-20251001": {
        input_per_mtok: 0.8,
        output_per_mtok: 4.0,
        cache_read_per_mtok: 0.08,
        cache_write_per_mtok: 1.0,
        source_url: "https://www.anthropic.com/pricing",
        as_of: "2026-05-15",
      },
    });

    const stderr: string[] = [];
    const io = {
      stdout: () => {},
      stderr: (s: string) => stderr.push(s),
    };

    const stubFetcher = async (): Promise<ModelsDevResponse> => ({
      data: [
        {
          id: "anthropic/claude-opus-4-7",
          pricing: {
            input_cost_per_mtok: 16.0, // different
            output_cost_per_mtok: 80.0, // different
            cache_read_cost_per_mtok: 1.6,
            cache_creation_cost_per_mtok: 20.0,
          },
        },
        // claude-sonnet-4-6: not included in response, should be marked as missing
        // claude-haiku-4-5-20251001: included with identical rates
        {
          id: "anthropic/claude-haiku-4-5",
          pricing: {
            input_cost_per_mtok: 0.8,
            output_cost_per_mtok: 4.0,
            cache_read_cost_per_mtok: 0.08,
            cache_creation_cost_per_mtok: 1.0,
          },
        },
      ],
    });

    const code = await runPricesUpdate({
      io,
      pricesPath,
      fetcher: stubFetcher,
    });

    expect(code).toBe(0);

    // Check output mentions updated and missing
    const output = stderr.join("");
    expect(output).toContain("updated:");
    expect(output).toContain("claude-opus-4-7");
    expect(output).toContain("no upstream data:");
    expect(output).toContain("claude-sonnet-4-6");

    // Verify file was written
    expect(output).toContain("wrote:");

    // Check that updated model has new rates
    const prices = readPrices();
    const opus = prices.models["claude-opus-4-7"];
    expect(opus).toBeDefined();
    if (!opus) throw new Error("opus not found");
    expect(opus.input_per_mtok).toBe(16.0);
    expect(opus.output_per_mtok).toBe(80.0);
    expect(opus.cache_write_per_mtok).toBe(20.0);

    // Check that unchanged model still has old rates
    const haiku = prices.models["claude-haiku-4-5-20251001"];
    expect(haiku).toBeDefined();
    if (!haiku) throw new Error("haiku not found");
    expect(haiku.input_per_mtok).toBe(0.8);
    expect(haiku.output_per_mtok).toBe(4.0);

    // Check as_of was updated
    expect(opus.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("skips manual rows and reports them", async () => {
    writePrices({
      "cursor-default": {
        input_per_mtok: null,
        output_per_mtok: null,
        source_url: "https://docs.cursor.com/pricing",
        as_of: "2026-05-15",
        manual: true,
        manual_note: "Headless mode does not publish per-token rates",
      },
    });

    const stderr: string[] = [];
    const io = {
      stdout: () => {},
      stderr: (s: string) => stderr.push(s),
    };

    const stubFetcher = async (): Promise<ModelsDevResponse> => ({
      data: [], // cursor not in upstream (no mapping)
    });

    const code = await runPricesUpdate({
      io,
      pricesPath,
      fetcher: stubFetcher,
    });

    expect(code).toBe(0);

    // Check output mentions skipped
    const output = stderr.join("");
    expect(output).toContain("skipped (manual override):");
    expect(output).toContain("cursor-default");

    // File should not be modified (no changes)
    const prices = readPrices();
    expect(prices.models["cursor-default"]).toEqual({
      input_per_mtok: null,
      output_per_mtok: null,
      source_url: "https://docs.cursor.com/pricing",
      as_of: "2026-05-15",
      manual: true,
      manual_note: "Headless mode does not publish per-token rates",
    });
  });

  it("handles network error without modifying file", async () => {
    writePrices({
      "claude-opus-4-7": {
        input_per_mtok: 15.0,
        output_per_mtok: 75.0,
        source_url: "https://www.anthropic.com/pricing",
        as_of: "2026-05-15",
      },
    });

    const originalContent = readFileSync(pricesPath, "utf8");

    const stderr: string[] = [];
    const io = {
      stdout: () => {},
      stderr: (s: string) => stderr.push(s),
    };

    const failingFetcher = async (): Promise<ModelsDevResponse> => {
      throw new Error("Network timeout");
    };

    const code = await runPricesUpdate({
      io,
      pricesPath,
      fetcher: failingFetcher,
    });

    expect(code).toBe(1);

    // File should be unchanged
    expect(readFileSync(pricesPath, "utf8")).toBe(originalContent);

    // Error should mention the upstream URL
    const errorOutput = stderr.join("");
    expect(errorOutput).toContain("models.dev");
    expect(code).toBe(1);
  });

  it("preserves cache rates when upstream does not provide them", async () => {
    writePrices({
      "claude-opus-4-7": {
        input_per_mtok: 15.0,
        output_per_mtok: 75.0,
        cache_read_per_mtok: 1.5,
        cache_write_per_mtok: 18.75,
        source_url: "https://www.anthropic.com/pricing",
        as_of: "2026-05-15",
      },
    });

    const stderr: string[] = [];
    const io = {
      stdout: () => {},
      stderr: (s: string) => stderr.push(s),
    };

    const stubFetcher = async (): Promise<ModelsDevResponse> => ({
      data: [
        {
          id: "anthropic/claude-opus-4-7",
          pricing: {
            input_cost_per_mtok: 16.0,
            output_cost_per_mtok: 80.0,
            // No cache rates provided
          },
        },
      ],
    });

    await runPricesUpdate({
      io,
      pricesPath,
      fetcher: stubFetcher,
    });

    const prices = readPrices();
    const opus = prices.models["claude-opus-4-7"];
    expect(opus).toBeDefined();
    if (!opus) throw new Error("opus not found");

    // Cache rates should be preserved
    expect(opus.cache_read_per_mtok).toBe(1.5);
    expect(opus.cache_write_per_mtok).toBe(18.75);
  });

  it("omits 'wrote' line when no rows changed", async () => {
    writePrices({
      "claude-opus-4-7": {
        input_per_mtok: 15.0,
        output_per_mtok: 75.0,
        source_url: "https://www.anthropic.com/pricing",
        as_of: "2026-05-15",
      },
    });

    const stderr: string[] = [];
    const io = {
      stdout: () => {},
      stderr: (s: string) => stderr.push(s),
    };

    const stubFetcher = async (): Promise<ModelsDevResponse> => ({
      data: [
        {
          id: "anthropic/claude-opus-4-7",
          pricing: {
            input_cost_per_mtok: 15.0, // same
            output_cost_per_mtok: 75.0, // same
          },
        },
      ],
    });

    const code = await runPricesUpdate({
      io,
      pricesPath,
      fetcher: stubFetcher,
    });

    expect(code).toBe(0);

    const output = stderr.join("");
    expect(output).toContain("unchanged:");
    expect(output).not.toContain("wrote:");
  });
});
