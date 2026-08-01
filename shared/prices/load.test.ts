import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadPrices } from "./load.ts";

describe("loadPrices", () => {
  const tmpDir = ".test-shared-prices";

  beforeAll(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
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
});
