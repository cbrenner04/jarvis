import { describe, expect, test } from "bun:test";
import { DEFAULT_WRITE_STEP_RULES } from "./step-rules.ts";

describe("DEFAULT_WRITE_STEP_RULES", () => {
  test("documents inside-the-test-body placement and adjacent-line above-test tolerance", () => {
    expect(DEFAULT_WRITE_STEP_RULES).toMatch(/inside the enclosing test body/i);
    expect(DEFAULT_WRITE_STEP_RULES).toMatch(/below the `test\("…", …\) => \{` line/i);
    expect(DEFAULT_WRITE_STEP_RULES).toMatch(/line immediately above the `test`\/`it` declaration/i);
    expect(DEFAULT_WRITE_STEP_RULES).toMatch(/next physical line/i);
    expect(DEFAULT_WRITE_STEP_RULES).toMatch(/verifier-tolerated/i);
    expect(DEFAULT_WRITE_STEP_RULES).toMatch(/inside-the-body is preferred/i);
  });
});
