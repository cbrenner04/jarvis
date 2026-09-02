import { describe, expect, test } from "bun:test";
import { endsWith, SHRINK_STEP_ID_SUFFIX, strip } from "./shrink-step-id.ts";

describe("shrink step id", () => {
  test("detects hidden-shrink suffix on representative step ids", () => {
    // @mutate shared/shrink-step-id.ts "stepId?.endsWith(SHRINK_STEP_ID_SUFFIX) === true" -> "stepId?.endsWith(SHRINK_STEP_ID_SUFFIX) !== true"
    expect(endsWith("implement~shrink")).toBe(true);
    expect(endsWith("step-1~shrink")).toBe(true);
    expect(endsWith("implement")).toBe(false);
    expect(endsWith(undefined)).toBe(false);
    expect(endsWith(null)).toBe(false);
  });

  test("strips suffix for round-trip with representative step ids", () => {
    for (const base of ["implement", "step-1", "step-2"]) {
      const hidden = `${base}${SHRINK_STEP_ID_SUFFIX}`;
      expect(endsWith(hidden)).toBe(true);
      expect(strip(hidden)).toBe(base);
      expect(`${strip(hidden)}${SHRINK_STEP_ID_SUFFIX}`).toBe(hidden);
    }
  });
});
