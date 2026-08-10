import { describe, expect, test } from "bun:test";
import { formatAbsoluteTimestamp } from "./tui-timestamp-format.ts";

describe("formatAbsoluteTimestamp", () => {
  test("converts a fixed epoch-ms value to UTC ISO 8601 with no fractional seconds", () => {
    // 2024-03-05T12:34:56.789Z
    expect(formatAbsoluteTimestamp(1_709_642_096_789)).toBe("2024-03-05T12:34:56Z");
  });

  test("formats epoch 0 as the Unix epoch instant", () => {
    expect(formatAbsoluteTimestamp(0)).toBe("1970-01-01T00:00:00Z");
  });

  test("returns the empty string for null", () => {
    // @mutate v2/src/tui/tui-timestamp-format.ts "if (epochMs == null) { return \"\"; }" -> "if (false) { return \"\"; }"
    expect(formatAbsoluteTimestamp(null)).toBe("");
  });

  test("returns the empty string for undefined", () => {
    expect(formatAbsoluteTimestamp(undefined)).toBe("");
  });

  test("returns 'invalid' for NaN without throwing", () => {
    expect(formatAbsoluteTimestamp(Number.NaN)).toBe("invalid");
  });

  test("returns 'invalid' for Infinity without throwing", () => {
    expect(formatAbsoluteTimestamp(Number.POSITIVE_INFINITY)).toBe("invalid");
  });

  test("returns 'invalid' for an out-of-range epoch value without throwing", () => {
    expect(formatAbsoluteTimestamp(8.64e15 + 1)).toBe("invalid");
  });
});
