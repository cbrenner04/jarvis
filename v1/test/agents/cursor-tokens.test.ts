import { describe, expect, test } from "bun:test";
import { estimateCursorUsage } from "../../src/agents/cursor-tokens.ts";
import { estimateTokenUsage } from "../../src/agents/token-estimation.ts";

describe("estimateCursorUsage", () => {
  test("returns zero tokens for empty prompt and stdout", () => {
    const result = estimateCursorUsage({ prompt: "", stdout: "" });
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.input_tokens).toBe(0);
      expect(result.output_tokens).toBe(0);
      expect(result.cache_read_input_tokens).toBe(0);
      expect(result.cache_creation_input_tokens).toBe(0);
    }
  });

  test("counts tokens for non-empty prompt and stdout", () => {
    const result = estimateCursorUsage({
      prompt: "write a function that adds two numbers",
      stdout: "function add(a, b) { return a + b; }",
    });
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.input_tokens).toBeGreaterThan(0);
      expect(result.output_tokens).toBeGreaterThan(0);
    }
  });

  test("scales with input size", () => {
    const small = estimateCursorUsage({ prompt: "hi", stdout: "" });
    const big = estimateCursorUsage({
      prompt: "hi ".repeat(1000),
      stdout: "",
    });
    expect(small).not.toBeNull();
    expect(big).not.toBeNull();
    if (small !== null && big !== null) {
      expect(big.input_tokens).toBeGreaterThan(small.input_tokens);
    }
  });
});

describe("estimateTokenUsage", () => {
  test("returns null when encoder init throws", () => {
    const result = estimateTokenUsage({
      prompt: "prompt",
      stdout: "stdout",
      loadEncoder: () => {
        throw new Error("init failed");
      },
    });
    expect(result).toBeNull();
  });

  test("returns null when tokenization throws", () => {
    const result = estimateTokenUsage({
      prompt: "prompt",
      stdout: "stdout",
      loadEncoder: () =>
        ({
          encode: () => {
            throw new Error("encode failed");
          },
        }) as never,
    });
    expect(result).toBeNull();
  });
});
