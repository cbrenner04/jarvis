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
});
