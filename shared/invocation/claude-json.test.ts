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

  test("parses terminal result unchanged when interleaved with stream_event partial deltas", () => {
    const partials = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "stream_event", event: { type: "content_block_start" } }),
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "considering..." } },
      }),
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "hel" } },
      }),
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "hello",
        total_cost_usd: 0.17160725,
        usage: {
          input_tokens: 6,
          output_tokens: 6,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 27349,
        },
      }),
    ].join("\n");

    const result = parseClaudeJsonOutput(partials);

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
    expect(result.warnings[0]).toContain("no terminal result event found");
  });

  test("handles malformed envelope", () => {
    const fixture = readFileSync(join(fixturesDir, "2.1.142-malformed.json"), "utf8");
    const result = parseClaudeJsonOutput(fixture);

    expect(result.displayText).toBe(fixture);
    expect(result.usage).toBeNull();
    expect(result.cost_usd).toBeNull();
    expect(result.warnings).toContain("no terminal result event found");
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

  test("classifies claude U+2019 quota phrases (session, spend, org's usage limit)", () => {
    const phrases = [
      "you’ve hit your session limit",
      "you’ve hit your monthly spend limit",
      "you’ve hit your org’s monthly usage limit",
    ];
    for (const phrase of phrases) {
      const envelope = JSON.stringify({
        type: "result",
        is_error: true,
        api_error_status: 429,
        result: phrase,
      });
      expect(isClaudeZeroExitQuotaEnvelope(envelope)).toBe(true);
    }
  });
});
