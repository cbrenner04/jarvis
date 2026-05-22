import { describe, expect, test } from "bun:test";
import { detectBlocker } from "../../../src/modes/plan/blocker.ts";

describe("detectBlocker", () => {
  test("returns hasBlocker=false for content with no blocker section", () => {
    const result = detectBlocker("# Intent\n\nDo a thing.\n");
    expect(result.hasBlocker).toBe(false);
    expect(result.body).toBeUndefined();
  });

  test("detects an exact ## Blocker heading and captures the body", () => {
    const result = detectBlocker(
      "# Intent\n\nDo a thing.\n\n## Blocker\n\nNeed clarification on X.\n",
    );
    expect(result.hasBlocker).toBe(true);
    expect(result.body).toBe("Need clarification on X.");
  });

  test("treats heading as case-sensitive (## blocker is not a match)", () => {
    const result = detectBlocker("# Intent\n\n## blocker\n\nlowercase\n");
    expect(result.hasBlocker).toBe(false);
  });

  test("requires the heading line to be exactly '## Blocker' (no trailing text)", () => {
    const result = detectBlocker("## Blocker reasons\n\nbody\n");
    expect(result.hasBlocker).toBe(false);
  });

  test("normalises CRLF line endings before scanning", () => {
    const result = detectBlocker("# Intent\r\n\r\n## Blocker\r\n\r\nbody\r\n");
    expect(result.hasBlocker).toBe(true);
    expect(result.body).toBe("body");
  });

  test("stops body capture at the next level-2 heading", () => {
    const result = detectBlocker(
      "## Blocker\n\nfirst paragraph\n\n## Next\n\nignored\n",
    );
    expect(result.hasBlocker).toBe(true);
    expect(result.body).toBe("first paragraph");
  });

  test("returns hasBlocker=true with no body when the section is empty", () => {
    const result = detectBlocker("# Intent\n\n## Blocker\n\n## Next\n");
    expect(result.hasBlocker).toBe(true);
    expect(result.body).toBeUndefined();
  });
});
