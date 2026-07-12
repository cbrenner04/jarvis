import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isClaudeZeroExitQuotaEnvelope, parseClaudeJsonOutput } from "../src/agents/claude-json.ts";

const fixturesDir = join(import.meta.dir, "fixtures", "claude");

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

  test("parses response with tool calls", () => {
    const fixture = readFileSync(join(fixturesDir, "2.1.142-with-tool-calls.json"), "utf8");
    const result = parseClaudeJsonOutput(fixture);

    expect(result.warnings).toEqual([]);
    expect(result.displayText).toContain("The current population of Australia");
    expect(result.usage).toBeTruthy();
    expect(result.usage?.input_tokens).toBe(120);
    expect(result.usage?.output_tokens).toBe(250);
    expect(result.cost_usd).toBe(0.05);
  });

  test("handles truncated stream gracefully", () => {
    const fixture = readFileSync(join(fixturesDir, "2.1.142-truncated.json"), "utf8");
    const result = parseClaudeJsonOutput(fixture);

    expect(result.displayText).toBe(fixture);
    expect(result.usage).toBeNull();
    expect(result.cost_usd).toBeNull();
    expect(result.warnings).toEqual(["no terminal result event found"]);
  });

  test("handles malformed envelope", () => {
    const fixture = readFileSync(join(fixturesDir, "2.1.142-malformed.json"), "utf8");
    const result = parseClaudeJsonOutput(fixture);

    expect(result.displayText).toBe(fixture);
    expect(result.usage).toBeNull();
    expect(result.cost_usd).toBeNull();
    expect(result.warnings).toEqual(["no terminal result event found"]);
  });

  test("extracts cost when total_cost_usd is present", () => {
    const json = JSON.stringify({
      type: "result",
      result: "test response",
      total_cost_usd: 0.025,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 1000,
      },
    });
    const result = parseClaudeJsonOutput(json);

    expect(result.cost_usd).toBe(0.025);
  });

  test("handles missing result field", () => {
    const json = JSON.stringify({
      type: "result",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 1000,
      },
    });
    const result = parseClaudeJsonOutput(json);

    expect(result.displayText).toBe("");
    expect(result.usage).toBeTruthy();
  });

  test("parses stream-json transcript matching batch envelope", () => {
    const batch = parseClaudeJsonOutput(readFileSync(join(fixturesDir, "2.1.142-simple-prose.json"), "utf8"));
    const stream = parseClaudeJsonOutput(readFileSync(join(fixturesDir, "2.1.142-simple-prose-stream.ndjson"), "utf8"));

    expect(stream.warnings).toEqual([]);
    expect(stream.displayText).toBe(batch.displayText);
    expect(stream.usage).toEqual(batch.usage);
    expect(stream.cost_usd).toBe(batch.cost_usd);
  });

  test("returns raw stdout when stream-json has no terminal result event", () => {
    const fixture = readFileSync(join(fixturesDir, "2.1.142-no-result-stream.ndjson"), "utf8");
    const result = parseClaudeJsonOutput(fixture);

    expect(result.displayText).toBe(fixture);
    expect(result.usage).toBeNull();
    expect(result.cost_usd).toBeNull();
    expect(result.warnings).toEqual(["no terminal result event found"]);
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

  test("matches stream-json quota envelope", () => {
    const fixture = readFileSync(join(fixturesDir, "2.1.142-monthly-spend-limit-stream.ndjson"), "utf8");
    expect(isClaudeZeroExitQuotaEnvelope(fixture)).toBe(true);
  });

  test("rejects zero-exit error envelopes missing quota predicates", () => {
    expect(
      isClaudeZeroExitQuotaEnvelope(
        JSON.stringify({
          type: "result",
          is_error: false,
          api_error_status: 429,
          result: "You've hit your monthly spend limit",
        }),
      ),
    ).toBe(false);
    expect(
      isClaudeZeroExitQuotaEnvelope(
        JSON.stringify({
          type: "result",
          is_error: true,
          api_error_status: 500,
          result: "You've hit your monthly spend limit",
        }),
      ),
    ).toBe(false);
    expect(
      isClaudeZeroExitQuotaEnvelope(
        JSON.stringify({
          type: "result",
          is_error: true,
          api_error_status: 429,
          result: "Not logged in · Please run /login",
        }),
      ),
    ).toBe(false);
  });
});
