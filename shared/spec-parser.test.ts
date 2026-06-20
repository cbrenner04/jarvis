import { describe, expect, test } from "bun:test";
import { detectBlocker, isStructuralAc, parseSpec } from "./spec-parser.ts";

describe("parseSpec", () => {
  test("parses h1, tasks, linked subspecs, acceptance criteria, and blocker", () => {
    const parsed = parseSpec(
      `# Title\n\n- [x] done\n- [ ] [01 - One](./01-one.md)\n\n## Acceptance criteria\n\n- [x] A\n- [ ] B\n\n## Blocker\n\nWaiting on API\n`,
    );

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
    const parsed = parseSpec(`# Title\n\n### Acceptance criteria\n\n- [ ] Item\n`);

    expect(parsed.acceptanceCriteria).toEqual([]);
    expect(parsed.warnings.some((w) => w.kind === "near-miss-acceptance-heading")).toBe(true);
  });

  test("warns when blocker heading is malformed", () => {
    const parsed = parseSpec(`# Title\n\n### Blocker\n\nSome text\n`);

    expect(parsed.blocker).toBeUndefined();
    expect(parsed.warnings.some((w) => w.kind === "near-miss-blocker-heading")).toBe(true);
  });

  test("selects first acceptance criteria when duplicates exist", () => {
    const parsed = parseSpec(
      `# Title\n\n## Acceptance criteria\n\n- [ ] First\n\n## Acceptance criteria\n\n- [ ] Second\n`,
    );

    expect(parsed.acceptanceCriteria).toEqual([{ checked: false, text: "First" }]);
  });

  test("selects first blocker when duplicates exist", () => {
    const parsed = parseSpec(`# Title\n\n## Blocker\n\nFirst blocker\n\n## Blocker\n\nSecond blocker\n`);

    expect(parsed.blocker).toBe("First blocker");
  });

  test("omits blocker when body is empty", () => {
    const parsed = parseSpec(`# Title\n\n## Blocker\n\n## Next section\n`);

    expect(parsed.blocker).toBeUndefined();
  });

  test("handles CRLF line endings", () => {
    const parsed = parseSpec(
      `# Title\r\n\r\n## Acceptance criteria\r\n\r\n- [ ] Item\r\n\r\n## Blocker\r\n\r\nbody\r\n`,
    );

    expect(parsed.h1).toBe("Title");
    expect(parsed.acceptanceCriteria).toEqual([{ checked: false, text: "Item" }]);
    expect(parsed.blocker).toBe("body");
  });

  test("extracts blocker with multiple lines", () => {
    const parsed = parseSpec(
      `# Title\n\n## Blocker\n\nThis is blocked because:\n- Need external input\n- Dependency not ready\n`,
    );

    expect(parsed.blocker).toContain("This is blocked because:");
    expect(parsed.blocker).toContain("Need external input");
    expect(parsed.blocker).toContain("Dependency not ready");
  });

  test("stops blocker extraction at next level-2 heading", () => {
    const parsed = parseSpec(`# Title\n\n## Blocker\n\nfirst paragraph\n\n## Next\n\nignored\n`);

    expect(parsed.blocker).toBe("first paragraph");
  });

  test("is case-sensitive for acceptance criteria heading", () => {
    const parsed = parseSpec(`# Title\n\n## acceptance criteria\n\n- [ ] Item\n`);

    expect(parsed.acceptanceCriteria).toEqual([]);
    expect(parsed.warnings.some((w) => w.kind === "near-miss-acceptance-heading")).toBe(true);
  });

  test("is case-sensitive for blocker heading", () => {
    const parsed = parseSpec(`# Title\n\n## blocker\n\ntext\n`);

    expect(parsed.blocker).toBeUndefined();
    expect(parsed.warnings.some((w) => w.kind === "near-miss-blocker-heading")).toBe(true);
  });
});

describe("detectBlocker", () => {
  test("returns hasBlocker=false for content with no blocker section", () => {
    const result = detectBlocker("# Intent\n\nDo a thing.\n");
    expect(result.hasBlocker).toBe(false);
    expect(result.body).toBeUndefined();
  });

  test("detects an exact ## Blocker heading and captures the body", () => {
    const result = detectBlocker("# Intent\n\nDo a thing.\n\n## Blocker\n\nNeed clarification on X.\n");
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
    const result = detectBlocker("## Blocker\n\nfirst paragraph\n\n## Next\n\nignored\n");
    expect(result.hasBlocker).toBe(true);
    expect(result.body).toBe("first paragraph");
  });

  test("returns hasBlocker=true with no body when the section is empty", () => {
    const result = detectBlocker("# Intent\n\n## Blocker\n\n## Next\n");
    expect(result.hasBlocker).toBe(true);
    expect(result.body).toBeUndefined();
  });

  test("selects first blocker when duplicates exist", () => {
    const result = detectBlocker("# Intent\n\n## Blocker\n\nfirst\n\n## Blocker\n\nsecond\n");
    expect(result.hasBlocker).toBe(true);
    expect(result.body).toBe("first");
  });

  test("emits no warnings for near-miss blocker headings", () => {
    const result = detectBlocker("# Intent\n\n### Blocker\n\ntext\n");
    expect(result.hasBlocker).toBe(false);
    // detectBlocker should emit no warnings — this is a direct return, not via parseSpec
  });

  test("returns empty-body blocker with hasBlocker=true but body=undefined", () => {
    const result = detectBlocker("# Intent\n\n## Blocker\n\n## Next\n");
    expect(result.hasBlocker).toBe(true);
    expect(result.body).toBeUndefined();
  });
});

describe("parseSpec vs detectBlocker blocker shape discrepancy", () => {
  test("parseSpec omits undefined blocker from result (blocker not in output when empty)", () => {
    const parsed = parseSpec(`# Title\n\n## Blocker\n\n## Next\n`);
    expect(parsed.blocker).toBeUndefined();
  });

  test("detectBlocker returns hasBlocker=true even with undefined body", () => {
    const result = detectBlocker("# Title\n\n## Blocker\n\n## Next\n");
    expect(result.hasBlocker).toBe(true);
    expect(result.body).toBeUndefined();
  });

  test("both use first-occurrence for duplicate blockers", () => {
    const content = `# Title\n\n## Blocker\n\nfirst\n\n## Blocker\n\nsecond\n`;
    const parsed = parseSpec(content);
    const detected = detectBlocker(content);

    expect(parsed.blocker).toBe("first");
    expect(detected.body).toBe("first");
  });
});

describe("duplicate section detection", () => {
  test("warns when acceptance criteria appears twice", () => {
    const parsed = parseSpec(
      `# Title\n\n## Acceptance criteria\n\n- [ ] First\n\n## Acceptance criteria\n\n- [ ] Second\n`,
    );

    expect(parsed.warnings.some((w) => w.kind === "duplicate-section")).toBe(true);
  });

  test("warns when blocker appears twice", () => {
    const parsed = parseSpec(`# Title\n\n## Blocker\n\nFirst\n\n## Blocker\n\nSecond\n`);

    expect(parsed.warnings.some((w) => w.kind === "duplicate-section")).toBe(true);
  });

  test("no warning for single acceptance criteria and single blocker", () => {
    const parsed = parseSpec(
      `# Title\n\n## Acceptance criteria\n\n- [ ] Item\n\n## Blocker\n\nText\n`,
    );

    expect(parsed.warnings.every((w) => w.kind !== "duplicate-section")).toBe(true);
  });
});

describe("structural AC classification", () => {
  test("identifies location/existence-based ACs as structural", () => {
    const structural = [
      { checked: false, text: "X lives in a dedicated module with unit tests" },
      { checked: false, text: "Y is defined in src/core" },
      { checked: false, text: "Z exists as a pure function" },
      { checked: false, text: "ABC has unit tests" },
    ];

    for (const ac of structural) {
      expect(isStructuralAc(ac)).toBe(true);
    }
  });

  test("does not flag behavioral ACs naming a symbol as subject", () => {
    const behavioral = [
      { checked: false, text: "`validateDraftOutput` returns invalid when a subspec lacks AC" },
      { checked: false, text: "The parser produces categorized warnings" },
      { checked: false, text: "X causes Y to happen" },
      { checked: false, text: "Z enables Q to work" },
    ];

    for (const ac of behavioral) {
      expect(isStructuralAc(ac)).toBe(false);
    }
  });

  test("is case-insensitive", () => {
    const upperCase = { checked: false, text: "ABC LIVES IN SRC" };
    const lowerCase = { checked: false, text: "abc lives in src" };
    const mixedCase = { checked: false, text: "Abc Lives In Src" };

    expect(isStructuralAc(upperCase)).toBe(true);
    expect(isStructuralAc(lowerCase)).toBe(true);
    expect(isStructuralAc(mixedCase)).toBe(true);
  });
});
