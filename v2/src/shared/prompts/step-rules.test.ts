import { describe, expect, test } from "bun:test";
import { DEFAULT_WRITE_STEP_RULES } from "./step-rules.ts";

describe("DEFAULT_WRITE_STEP_RULES", () => {
  test("omits retired checkpoint authoring", () => {
    expect(DEFAULT_WRITE_STEP_RULES).not.toContain("@mutate");
    expect(DEFAULT_WRITE_STEP_RULES).not.toContain("Guard-inversion criteria require");
  });
});
