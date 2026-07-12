import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isClaudeZeroExitQuotaEnvelope, parseClaudeJsonOutput } from "./claude-json.ts";

const fixturesDir = join(import.meta.dir, "../../v1/test/fixtures/claude");

describe("parseClaudeJsonOutput", () => {
  test("parses simple prose response without warnings", () => {
    const fixture = readFileSync(join(fixturesDir, "2.1.142-simple-prose.json"), "utf8");
    const result = parseClaudeJsonOutput(fixture);

    expect(result.warnings).toEqual([]);
    expect(result.displayText).toBe("hello");
    expect(result.usage).toEqual({
      input_tokens: 6,
      output_tokens: 6,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 27349,
    });
    expect(result.cost_usd).toBe(0.17160725);
  });

  test("handles truncated stream gracefully", () => {
    const fixture = readFileSync(join(fixturesDir, "2.1.142-truncated.json"), "utf8");
    const result = parseClaudeJsonOutput(fixture);

    expect(result.displayText).toBe(fixture);
    expect(result.usage).toBeNull();
    expect(result.cost_usd).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("JSON parse error");
  });

  test("handles malformed envelope", () => {
    const fixture = readFileSync(join(fixturesDir, "2.1.142-malformed.json"), "utf8");
    const result = parseClaudeJsonOutput(fixture);

    expect(result.displayText).toBe("");
    expect(result.usage).toBeNull();
    expect(result.cost_usd).toBeNull();
    expect(result.warnings).toEqual([]);
  });
});

describe("isClaudeZeroExitQuotaEnvelope", () => {
  test("matches verified monthly-spend-limit fixture", () => {
    const fixture = readFileSync(join(fixturesDir, "2.1.142-monthly-spend-limit.json"), "utf8");
    expect(isClaudeZeroExitQuotaEnvelope(fixture)).toBe(true);
  });

  test("rejects successful prose envelope", () => {
    const fixture = readFileSync(join(fixturesDir, "2.1.142-simple-prose.json"), "utf8");
    expect(isClaudeZeroExitQuotaEnvelope(fixture)).toBe(false);
  });
});
