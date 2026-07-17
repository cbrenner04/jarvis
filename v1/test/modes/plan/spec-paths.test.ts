import { describe, expect, test } from "bun:test";
import { stripPlanSpecTimestampPrefix } from "../../../src/modes/plan/spec-paths.ts";

describe("stripPlanSpecTimestampPrefix", () => {
  test("strips v1 dashed timestamp format", () => {
    expect(stripPlanSpecTimestampPrefix("2026-07-16T21-57-24Z-my-plan")).toBe("my-plan");
  });

  test("strips v2 compact timestamp format", () => {
    expect(stripPlanSpecTimestampPrefix("20260716T215724Z-my-plan")).toBe("my-plan");
  });

  test("returns untimestamped basename unchanged", () => {
    expect(stripPlanSpecTimestampPrefix("my-plan")).toBe("my-plan");
  });

  test("handles names with hyphens", () => {
    expect(stripPlanSpecTimestampPrefix("2026-07-16T21-57-24Z-my-cool-plan")).toBe("my-cool-plan");
    expect(stripPlanSpecTimestampPrefix("20260716T215724Z-my-cool-plan")).toBe("my-cool-plan");
  });

  test("handles names with numbers", () => {
    expect(stripPlanSpecTimestampPrefix("2026-07-16T21-57-24Z-plan-123")).toBe("plan-123");
    expect(stripPlanSpecTimestampPrefix("20260716T215724Z-plan-123")).toBe("plan-123");
  });
});
