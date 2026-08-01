import { describe, expect, test } from "bun:test";
import { parseCursorJsonOutput } from "./cursor-json.ts";

describe("parseCursorJsonOutput", () => {
  test("parses terminal result event with result field", () => {
    const stdout = JSON.stringify({ type: "result", result: "implementation done\n" });

    const result = parseCursorJsonOutput(stdout);

    expect(result.displayText).toBe("implementation done");
  });

  test("concatenates text-delta frames when no terminal result event", () => {
    const frames = [
      JSON.stringify({ type: "text_delta", text: "chunk " }),
      JSON.stringify({ type: "text_delta", text: "one" }),
    ].join("\n");

    const result = parseCursorJsonOutput(frames);

    expect(result.displayText).toBe("chunk one");
    expect(result.usage).toBeUndefined();
  });

  test("falls back to verbatim stdout when no parseable frames or result", () => {
    const stdout = "not json\nat all\n";

    const result = parseCursorJsonOutput(stdout);

    expect(result.displayText).toBe(stdout);
  });

  test("trims trailing whitespace from result text", () => {
    const stdout = JSON.stringify({ type: "result", result: "done   \n" });

    const result = parseCursorJsonOutput(stdout);

    expect(result.displayText).toBe("done");
  });

  test("prefers result event over text-delta frames", () => {
    const frames = [
      JSON.stringify({ type: "text_delta", text: "ignored frame" }),
      JSON.stringify({ type: "result", result: "preferred result" }),
    ].join("\n");

    const result = parseCursorJsonOutput(frames);

    expect(result.displayText).toBe("preferred result");
  });

  test("uses last result event when multiple are present", () => {
    const frames = [
      JSON.stringify({ type: "result", result: "first" }),
      JSON.stringify({ type: "result", result: "second" }),
    ].join("\n");

    const result = parseCursorJsonOutput(frames);

    expect(result.displayText).toBe("second");
  });

  test("skips empty lines and unparseable lines", () => {
    const frames = [
      JSON.stringify({ type: "text_delta", text: "part " }),
      "",
      "garbage line",
      JSON.stringify({ type: "text_delta", text: "one" }),
    ].join("\n");

    const result = parseCursorJsonOutput(frames);

    expect(result.displayText).toBe("part one");
  });

  test("handles delta field variant for text frames", () => {
    const frames = [
      JSON.stringify({ type: "text_delta", delta: "frame " }),
      JSON.stringify({ type: "text_delta", delta: "text" }),
    ].join("\n");

    const result = parseCursorJsonOutput(frames);

    expect(result.displayText).toBe("frame text");
  });

  test("handles assistant frame type for text frames", () => {
    const frames = [
      JSON.stringify({ type: "assistant", text: "part " }),
      JSON.stringify({ type: "assistant", text: "one" }),
    ].join("\n");

    const result = parseCursorJsonOutput(frames);

    expect(result.displayText).toBe("part one");
  });

  test("returns verbatim output when everything is empty", () => {
    const stdout = "";

    const result = parseCursorJsonOutput(stdout);

    expect(result.displayText).toBe("");
  });

  test("returns empty text, not the transcript, when the terminal result is empty", () => {
    const transcript = [
      JSON.stringify({ type: "text_delta", text: "thinking " }),
      JSON.stringify({ type: "text_delta", text: "out loud" }),
      JSON.stringify({ type: "result", result: "" }),
    ].join("\n");

    const result = parseCursorJsonOutput(transcript);

    expect(result.displayText).toBe("");
  });

  test("returns empty text, not the transcript, when the terminal result is whitespace", () => {
    const transcript = [
      JSON.stringify({ type: "text_delta", text: "chunk" }),
      JSON.stringify({ type: "result", result: "  \n" }),
    ].join("\n");

    const result = parseCursorJsonOutput(transcript);

    expect(result.displayText).toBe("");
  });

  test("returns empty text, not the transcript, when frames carry only empty text", () => {
    const transcript = [
      JSON.stringify({ type: "text_delta", text: "" }),
      JSON.stringify({ type: "text_delta", text: "" }),
    ].join("\n");

    const result = parseCursorJsonOutput(transcript);

    expect(result.displayText).toBe("");
  });

  test("maps usage from terminal result frame alongside displayText", () => {
    const stdout = JSON.stringify({
      type: "result",
      result: "implementation done\n",
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 10,
        cacheWriteTokens: 0,
      },
    });

    const result = parseCursorJsonOutput(stdout);

    expect(result.displayText).toBe("implementation done");
    expect(result.usage).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 10,
      cache_creation_input_tokens: 0,
    });
    // Guard inversion: mapping cacheReadTokens into input_tokens turns this test RED.
  });

  test.each([
    ["absent", { type: "result", result: "done" }],
    ["null", { type: "result", result: "done", usage: null }],
    ["non-object array", { type: "result", result: "done", usage: [] }],
    ["non-object string", { type: "result", result: "done", usage: "bad" }],
  ])("omits usage when terminal result usage is %s", (_label, frame) => {
    const stdout = JSON.stringify(frame);

    const result = parseCursorJsonOutput(stdout);

    expect(result.displayText).toBe("done");
    expect(result.usage).toBeUndefined();
    // Guard inversion: always attaching a usage object on the result path turns this test RED.
  });

  test("returns usage from terminal result while displayText falls back to text deltas", () => {
    const transcript = [
      JSON.stringify({ type: "text_delta", text: "chunk " }),
      JSON.stringify({ type: "text_delta", text: "one" }),
      JSON.stringify({
        type: "result",
        result: null,
        usage: {
          inputTokens: 42,
          outputTokens: 7,
          cacheReadTokens: 3,
          cacheWriteTokens: 1,
        },
      }),
    ].join("\n");

    const result = parseCursorJsonOutput(transcript);

    expect(result.displayText).toBe("chunk one");
    expect(result.usage).toEqual({
      input_tokens: 42,
      output_tokens: 7,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 1,
    });
  });

  test("omits usage when only the first of two result frames carries usage", () => {
    const frames = [
      JSON.stringify({
        type: "result",
        result: "first",
        usage: {
          inputTokens: 999,
          outputTokens: 888,
          cacheReadTokens: 777,
          cacheWriteTokens: 666,
        },
      }),
      JSON.stringify({ type: "result", result: "second" }),
    ].join("\n");

    const result = parseCursorJsonOutput(frames);

    expect(result.displayText).toBe("second");
    expect(result.usage).toBeUndefined();
  });

  test.each([
    [
      "empty object",
      {},
      {
        input_tokens: null,
        output_tokens: null,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: null,
      },
    ],
    [
      "partial",
      { inputTokens: 5, outputTokens: 2 },
      {
        input_tokens: 5,
        output_tokens: 2,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: null,
      },
    ],
  ])("returns present usage with null for missing fields when usage is %s", (_label, usage, expected) => {
    const stdout = JSON.stringify({ type: "result", result: "done", usage });

    const result = parseCursorJsonOutput(stdout);

    expect(result.displayText).toBe("done");
    expect(result.usage).toEqual(expected);
  });
});
