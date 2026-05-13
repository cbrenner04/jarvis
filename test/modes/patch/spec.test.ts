import { describe, expect, test } from "bun:test";
import { parsePatchSpec } from "../../../src/modes/patch/spec.ts";

describe("parsePatchSpec", () => {
  test("parses h1, tasks, linked subspecs, acceptance criteria, and blocker", () => {
    const parsed = parsePatchSpec(`# Title\n\n- [x] done\n- [ ] [01 - One](./01-one.md)\n\n## Acceptance criteria\n\n- [x] A\n- [ ] B\n\n## Blocker\n\nWaiting on API\n`);

    expect(parsed.h1).toBe("Title");
    expect(parsed.tasks).toEqual([
      { checked: true, body: "done" },
      { checked: false, body: "[01 - One](./01-one.md)" },
      { checked: true, body: "A" },
      { checked: false, body: "B" },
    ]);
    expect(parsed.linkedSubspecs).toEqual([
      {
        checked: false,
        body: "[01 - One](./01-one.md)",
        text: "01 - One",
        path: "./01-one.md",
      },
    ]);
    expect(parsed.acceptanceCriteria).toEqual([
      { checked: true, text: "A" },
      { checked: false, text: "B" },
    ]);
    expect(parsed.blocker).toBe("Waiting on API");
    expect(parsed.warnings).toEqual([]);
  });

  test("warns when acceptance criteria heading is malformed", () => {
    const parsed = parsePatchSpec(`# Title\n\n### Acceptance criteria\n\n- [ ] Item\n`);

    expect(parsed.acceptanceCriteria).toEqual([]);
    expect(parsed.warnings).toContain(
      "Rejected heading `### Acceptance criteria`: acceptance criteria header must be exactly `## Acceptance criteria` (case-sensitive, level-2).",
    );
  });
});
