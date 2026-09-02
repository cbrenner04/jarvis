import { describe, expect, test } from "bun:test";
import { isRecord } from "./is-record.ts";

describe("isRecord", () => {
  test("accepts plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ cwd: "/tmp", configPath: "/cfg" })).toBe(true);
  });

  test("rejects arrays, null, and primitives", () => {
    // @mutate shared/is-record.ts "!Array.isArray(value)" -> "Array.isArray(value)"
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("object")).toBe(false);
    expect(isRecord(0)).toBe(false);
    expect(isRecord(false)).toBe(false);
  });
});
