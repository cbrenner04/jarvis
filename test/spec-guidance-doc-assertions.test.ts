import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SPEC_GUIDANCE = readFileSync(join(import.meta.dir, "..", "v1", "docs", "spec-guidance.md"), "utf8");
const RULE_OUT_GUIDANCE =
  SPEC_GUIDANCE.match(
    /#### Rule-out and invariant guards: cite reachability on the base\n([\s\S]*?)(?=\n#### )/,
  )?.[1] ?? "";
const FAILING_TEST_GUIDANCE =
  SPEC_GUIDANCE.match(/#### Failing-test requirement for runtime-behavior subspecs\n([\s\S]*?)(?=\n#### )/)?.[1] ?? "";

describe("spec-guidance plan authoring", () => {
  test("requires a named pre-fix failing test", () => {
    expect(FAILING_TEST_GUIDANCE).toContain(
      "naming a test that fails against the pre-fix code and passes after the change",
    );
    expect(FAILING_TEST_GUIDANCE).toContain('"Existing tests stay green" does not satisfy this requirement');
  });

  test("retains pinning-test reachability without checkpoint authoring", () => {
    expect(RULE_OUT_GUIDANCE).toContain("a regression or pinning test naming the failure scenario");
    expect(RULE_OUT_GUIDANCE).toContain("fails against the pre-fix");
    expect(SPEC_GUIDANCE).not.toContain("Mutation checkpoint:");
    expect(SPEC_GUIDANCE).not.toContain("Keystone checkpoint:");
    expect(SPEC_GUIDANCE).not.toContain("@mutate");
  });
});
