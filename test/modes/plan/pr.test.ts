import { describe, expect, test } from "bun:test";
import { buildPlanPrHeader } from "../../../src/modes/plan/pr.ts";
import {
  extractNarrative,
  NARRATIVE_END_MARKER,
  NARRATIVE_START_MARKER,
} from "../../../src/pr.ts";

describe("buildPlanPrHeader", () => {
  test("builds header with correct name interpolation", () => {
    const header = buildPlanPrHeader({ name: "my-feature" });
    expect(header).toContain("spec/my-feature/");
    expect(header).toContain("spec/my-feature/intent.md");
    expect(header).toContain("spec/my-feature/index.md");
  });

  test("includes the 'plan mode never marks ready' paragraph", () => {
    const header = buildPlanPrHeader({ name: "test" });
    expect(header).toContain("Plan mode never marks this PR ready for review");
    expect(header).toContain("mark it ready and merge to `main`");
    expect(header).toContain("jarvis run");
    expect(header).toContain("spec/test/index.md");
  });

  test("is deterministic - same input produces same output", () => {
    const header1 = buildPlanPrHeader({ name: "feature-a" });
    const header2 = buildPlanPrHeader({ name: "feature-a" });
    expect(header1).toBe(header2);
  });

  test("renders as markdown text, not HTML", () => {
    const header = buildPlanPrHeader({ name: "test" });
    expect(header).not.toContain("<");
    expect(header).not.toContain(">");
  });
});

describe("extractNarrative - shared utility", () => {
  test("extracts narrative between markers", () => {
    const body = `header
${NARRATIVE_START_MARKER}
This is narrative content.
${NARRATIVE_END_MARKER}
footer`;
    expect(extractNarrative(body)).toBe("This is narrative content.");
  });

  test("returns null when markers are missing", () => {
    const body = "just body text";
    expect(extractNarrative(body)).toBeNull();
  });

  test("trims whitespace around narrative", () => {
    const body = `${NARRATIVE_START_MARKER}

  narrative text

${NARRATIVE_END_MARKER}`;
    expect(extractNarrative(body)).toBe("narrative text");
  });
});
