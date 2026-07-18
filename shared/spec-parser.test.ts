import { describe, expect, test } from "bun:test";
import {
  detectBlocker,
  detectBlockerClaim,
  hasPathLikeAnchor,
  isBehavioralPreservationAc,
  isStructuralAc,
  isUnsatisfiableAc,
  parseRunnableIndexTier,
  parseSpec,
  stripBlockerSection,
} from "./spec-parser.ts";

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
      { checked: true, text: "A", humanOnly: false },
      { checked: false, text: "B", humanOnly: false },
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

    expect(parsed.acceptanceCriteria).toEqual([{ checked: false, text: "First", humanOnly: false }]);
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
    expect(parsed.acceptanceCriteria).toEqual([{ checked: false, text: "Item", humanOnly: false }]);
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
    const parsed = parseSpec(`# Title\n\n## Acceptance criteria\n\n- [ ] Item\n\n## Blocker\n\nText\n`);

    expect(parsed.warnings.every((w) => w.kind !== "duplicate-section")).toBe(true);
  });
});

describe("structural AC classification", () => {
  test("identifies location/existence-based ACs as structural", () => {
    const structural = [
      { checked: false, text: "X lives in a dedicated module with unit tests", humanOnly: false },
      { checked: false, text: "Y is defined in src/core", humanOnly: false },
      { checked: false, text: "Z exists as a pure function", humanOnly: false },
      { checked: false, text: "ABC has unit tests", humanOnly: false },
    ];

    for (const ac of structural) {
      expect(isStructuralAc(ac)).toBe(true);
    }
  });

  test("does not flag behavioral ACs naming a symbol as subject", () => {
    const behavioral = [
      { checked: false, text: "`validateDraftOutput` returns invalid when a subspec lacks AC", humanOnly: false },
      { checked: false, text: "The parser produces categorized warnings", humanOnly: false },
      { checked: false, text: "X causes Y to happen", humanOnly: false },
      { checked: false, text: "Z enables Q to work", humanOnly: false },
    ];

    for (const ac of behavioral) {
      expect(isStructuralAc(ac)).toBe(false);
    }
  });

  test("is case-insensitive", () => {
    const upperCase = { checked: false, text: "ABC LIVES IN SRC", humanOnly: false };
    const lowerCase = { checked: false, text: "abc lives in src", humanOnly: false };
    const mixedCase = { checked: false, text: "Abc Lives In Src", humanOnly: false };

    expect(isStructuralAc(upperCase)).toBe(true);
    expect(isStructuralAc(lowerCase)).toBe(true);
    expect(isStructuralAc(mixedCase)).toBe(true);
  });
});

describe("behavioral/preservation AC detection", () => {
  test("detects ACs with preservation/continuation trigger verbs", () => {
    const behavioral = [
      { checked: false, text: "plan stops on a hard error", humanOnly: false },
      { checked: false, text: "X stays green across the change", humanOnly: false },
      { checked: false, text: "config value remains unchanged", humanOnly: false },
      { checked: false, text: "API continues to work", humanOnly: false },
      { checked: false, text: "behavior is preserved", humanOnly: false },
      { checked: false, text: "test suite remains unaffected", humanOnly: false },
    ];

    for (const ac of behavioral) {
      expect(isBehavioralPreservationAc(ac)).toBe(true);
    }
  });

  test("is case-insensitive for trigger verbs", () => {
    const upperCase = { checked: false, text: "PLAN STOPS ON HARD ERROR", humanOnly: false };
    const lowerCase = { checked: false, text: "plan stops on hard error", humanOnly: false };
    const mixedCase = { checked: false, text: "Plan Stops On Hard Error", humanOnly: false };

    expect(isBehavioralPreservationAc(upperCase)).toBe(true);
    expect(isBehavioralPreservationAc(lowerCase)).toBe(true);
    expect(isBehavioralPreservationAc(mixedCase)).toBe(true);
  });

  test("does not flag ACs without trigger verbs", () => {
    const nonBehavioral = [
      { checked: false, text: "X returns invalid when a subspec lacks AC", humanOnly: false },
      { checked: false, text: "validator parses specs correctly", humanOnly: false },
      { checked: false, text: "The feature works", humanOnly: false },
    ];

    for (const ac of nonBehavioral) {
      expect(isBehavioralPreservationAc(ac)).toBe(false);
    }
  });

  test("requires whole-word match for trigger verbs", () => {
    // "stopping" should not match "stops"
    const notMatch = { checked: false, text: "stopping the process continues smoothly", humanOnly: false };
    expect(isBehavioralPreservationAc(notMatch)).toBe(true); // Still true because "continues" is present
  });
});

describe("parseRunnableIndexTier", () => {
  test("accepts one early tier line", () => {
    expect(parseRunnableIndexTier("# Spec\nrepo: owner/repo\ntier: standard\n\n- [ ] task\n")).toEqual({
      tier: "standard",
      error: undefined,
    });
  });

  test("defaults to undefined when no tier line exists", () => {
    expect(parseRunnableIndexTier("# Spec\n- [ ] task\n")).toEqual({
      tier: undefined,
      error: undefined,
    });
  });

  test("rejects blank tier values", () => {
    expect(parseRunnableIndexTier("# Spec\ntier: \n- [ ] task\n").error).toContain(
      "expected one of trivial, standard, hard",
    );
  });

  test("rejects unknown tier values", () => {
    expect(parseRunnableIndexTier("# Spec\ntier: Hard\n- [ ] task\n").error).toContain(
      "expected one of trivial, standard, hard",
    );
  });

  test("rejects duplicate tier lines", () => {
    expect(parseRunnableIndexTier("# Spec\ntier: trivial\ntier: hard\n- [ ] task\n").error).toContain(
      "duplicate `tier:` line",
    );
  });

  test("rejects later tier lines", () => {
    expect(parseRunnableIndexTier("# Spec\n- [ ] task\ntier: hard\n").error).toContain(
      "`tier:` must appear before the first checklist item",
    );
  });

  test("ignores indented tier-like lines", () => {
    expect(parseRunnableIndexTier("# Spec\n  tier: hard\n- [ ] task\n")).toEqual({
      tier: undefined,
      error: undefined,
    });
  });
});

describe("path-like anchor detection", () => {
  test("detects *.test.ts filename patterns", () => {
    const withTestFile = [
      { checked: false, text: "plan-draft-hard-error-continue.test.ts stays green", humanOnly: false },
      { checked: false, text: "`spec-parser.test.ts` remains working", humanOnly: false },
      { checked: false, text: "validator.test.ts continues to pass", humanOnly: false },
    ];

    for (const ac of withTestFile) {
      expect(hasPathLikeAnchor(ac)).toBe(true);
    }
  });

  test("detects backtick spans with path separators", () => {
    const withPathSeparator = [
      { checked: false, text: "`v1/src/commands/plan.ts` is preserved", humanOnly: false },
      { checked: false, text: "code in `shared/spec-parser.ts` stays unchanged", humanOnly: false },
      { checked: false, text: "config remains at `v1/docs/config.md`", humanOnly: false },
    ];

    for (const ac of withPathSeparator) {
      expect(hasPathLikeAnchor(ac)).toBe(true);
    }
  });

  test("detects backtick spans with source-file extensions", () => {
    const withExtension = [
      { checked: false, text: "`parseSpec.ts` stays functional", humanOnly: false },
      { checked: false, text: "module `helper.js` is preserved", humanOnly: false },
      { checked: false, text: "file `config.json` remains unchanged", humanOnly: false },
    ];

    for (const ac of withExtension) {
      expect(hasPathLikeAnchor(ac)).toBe(true);
    }
  });

  test("does not flag plain backtick spans without path shape", () => {
    const nonPath = [
      { checked: false, text: '`patch_phase: "shrink"` is preserved', humanOnly: false },
      { checked: false, text: "value `x` stays the same", humanOnly: false },
      { checked: false, text: "error code `E_NOMEM` remains unchanged", humanOnly: false },
    ];

    for (const ac of nonPath) {
      expect(hasPathLikeAnchor(ac)).toBe(false);
    }
  });

  test("detects multiple backtick spans and passes if any has path shape", () => {
    const multiBacktick = { checked: false, text: "both `x` and `v1/src/file.ts` stay the same", humanOnly: false };
    expect(hasPathLikeAnchor(multiBacktick)).toBe(true);
  });
});

describe("anchor grounding in parseSpec", () => {
  test("warns when behavioral AC lacks anchor", () => {
    const parsed = parseSpec(`# Title\n\n## Acceptance criteria\n\n- [ ] plan stops on a hard error\n`);

    expect(parsed.warnings.some((w) => w.kind === "missing-anchor-behavioral-ac")).toBe(true);
  });

  test("does not warn when behavioral AC has test file anchor", () => {
    const parsed = parseSpec(
      `# Title\n\n## Acceptance criteria\n\n- [ ] \`plan-draft-hard-error-continue.test.ts\` stays green\n`,
    );

    expect(parsed.warnings.every((w) => w.kind !== "missing-anchor-behavioral-ac")).toBe(true);
  });

  test("does not warn when behavioral AC has source path anchor", () => {
    const parsed = parseSpec(
      `# Title\n\n## Acceptance criteria\n\n- [ ] code in \`v1/src/commands/plan.ts\` stays unchanged\n`,
    );

    expect(parsed.warnings.every((w) => w.kind !== "missing-anchor-behavioral-ac")).toBe(true);
  });

  test("warns when trigger AC has only non-path backtick span", () => {
    const parsed = parseSpec(`# Title\n\n## Acceptance criteria\n\n- [ ] \`patch_phase: "shrink"\` is preserved\n`);

    expect(parsed.warnings.some((w) => w.kind === "missing-anchor-behavioral-ac")).toBe(true);
  });

  test("does not warn for non-trigger behavioral AC", () => {
    const parsed = parseSpec(`# Title\n\n## Acceptance criteria\n\n- [ ] X returns invalid when a subspec lacks AC\n`);

    expect(parsed.warnings.every((w) => w.kind !== "missing-anchor-behavioral-ac")).toBe(true);
  });

  test("warns only for trigger ACs without anchors in mixed criteria", () => {
    const parsed = parseSpec(
      `# Title\n\n## Acceptance criteria\n\n- [ ] X returns invalid when Y\n- [ ] plan stops on hard error\n- [ ] \`spec-parser.test.ts\` stays green\n`,
    );

    const anchorWarnings = parsed.warnings.filter((w) => w.kind === "missing-anchor-behavioral-ac");
    expect(anchorWarnings).toHaveLength(1);
    expect(anchorWarnings[0]?.message).toContain("plan stops on hard error");
  });
});

describe("blocker claim detection", () => {
  test("detects pre-existing-failure language in blocker bodies", () => {
    const claimBodies = [
      "This is a pre-existing failure",
      "This is a preexisting failure",
      "This is unrelated to my changes",
      "Baseline already fails with this error",
      "This error is not caused by my changes",
      "This is not related to my changes",
      "This is not my change, just existing issue",
    ];

    for (const body of claimBodies) {
      expect(detectBlockerClaim(body)).toBe(true);
    }
  });

  test("is case-insensitive for claim detection", () => {
    expect(detectBlockerClaim("This is a PRE-EXISTING failure")).toBe(true);
    expect(detectBlockerClaim("This is UNRELATED to my changes")).toBe(true);
    expect(detectBlockerClaim("BASELINE already fails")).toBe(true);
  });

  test("does not flag non-claim blockers", () => {
    const nonClaimBodies = [
      "Need implementation details",
      "Waiting on external API",
      "Something blocked the work",
      "This feature requires more thought",
    ];

    for (const body of nonClaimBodies) {
      expect(detectBlockerClaim(body)).toBe(false);
    }
  });
});

describe("blocker section stripping", () => {
  test("removes ## Blocker section and leaves content intact", () => {
    const content = `# Title

## Acceptance criteria

- [x] First
- [ ] Second

## Blocker

This is blocked`;

    const stripped = stripBlockerSection(content);
    expect(stripped).toBe(`# Title

## Acceptance criteria

- [x] First
- [ ] Second`);
  });

  test("handles blocker as last section", () => {
    const content = `# Title

## Acceptance criteria

- [ ] Item

## Blocker

Blocked`;

    const stripped = stripBlockerSection(content);
    expect(stripped).toBe(`# Title

## Acceptance criteria

- [ ] Item`);
  });

  test("preserves other sections after blocker", () => {
    const content = `# Title

## Blocker

Blocked

## Notes

Some notes`;

    const stripped = stripBlockerSection(content);
    expect(stripped).toBe(`# Title

## Notes

Some notes`);
  });

  test("handles blocker with multiline content", () => {
    const content = `# Title

## Blocker

First line
Second line
Third line

## Next section

Content`;

    const stripped = stripBlockerSection(content);
    expect(stripped).toBe(`# Title

## Next section

Content`);
  });

  test("returns unchanged content if no blocker exists", () => {
    const content = `# Title

## Acceptance criteria

- [ ] Item`;

    const stripped = stripBlockerSection(content);
    expect(stripped).toBe(content);
  });
});

describe("human-only criterion detection", () => {
  test("detects (Manual) marker at end of criterion text", () => {
    const criteria = [
      { checked: false, text: "Feature works in the live iOS simulator. (Manual)", humanOnly: false },
      { checked: false, text: "Verify the dashboard redesign. (Manual)", humanOnly: false },
    ];

    for (const c of criteria) {
      expect(parseSpec(`# Title\n\n## Acceptance criteria\n\n- [ ] ${c.text}\n`).acceptanceCriteria[0]).toEqual({
        checked: false,
        text: c.text,
        humanOnly: true,
      });
    }
  });

  test("detects 'visual inspection only' marker at end", () => {
    const text = "No visual regressions on the dashboard. visual inspection only";
    const parsed = parseSpec(`# Title\n\n## Acceptance criteria\n\n- [ ] ${text}\n`);

    expect(parsed.acceptanceCriteria[0]).toEqual({
      checked: false,
      text,
      humanOnly: true,
    });
  });

  test("detects 'no automated guard' marker at end", () => {
    const text = "Code follows team conventions. no automated guard";
    const parsed = parseSpec(`# Title\n\n## Acceptance criteria\n\n- [ ] ${text}\n`);

    expect(parsed.acceptanceCriteria[0]).toEqual({
      checked: false,
      text,
      humanOnly: true,
    });
  });

  test("is case-insensitive for human-only markers", () => {
    const testCases = [
      "Feature works. (MANUAL)",
      "Feature works. (Manual)",
      "Feature works. (manual)",
      "Feature works. VISUAL INSPECTION ONLY",
      "Feature works. Visual Inspection Only",
      "Feature works. NO AUTOMATED GUARD",
      "Feature works. No Automated Guard",
    ];

    for (const text of testCases) {
      const parsed = parseSpec(`# Title\n\n## Acceptance criteria\n\n- [ ] ${text}\n`);
      expect(parsed.acceptanceCriteria[0]?.humanOnly).toBe(true);
    }
  });

  test("ignores trailing whitespace and period before marker", () => {
    const testCases = [
      "Feature works. (Manual).",
      "Feature works.   (Manual)",
      "Feature works.\t(Manual)",
      "Feature works.  visual inspection only.",
      "Feature works. no automated guard  ",
    ];

    for (const text of testCases) {
      const parsed = parseSpec(`# Title\n\n## Acceptance criteria\n\n- [ ] ${text}\n`);
      expect(parsed.acceptanceCriteria[0]?.humanOnly).toBe(true);
    }
  });

  test("does not match markers mid-text", () => {
    const testCases = [
      "Feature works. (Manual) if conditions are met.",
      "Add an automated guard where there is no automated guard today.",
      "Visual inspection only, not manual.",
    ];

    for (const text of testCases) {
      const parsed = parseSpec(`# Title\n\n## Acceptance criteria\n\n- [ ] ${text}\n`);
      expect(parsed.acceptanceCriteria[0]?.humanOnly).toBe(false);
    }
  });

  test("classifies unmarked criteria as automated", () => {
    const testCases = [
      "Feature works when invoked.",
      "Code compiles without errors.",
      "Tests pass.",
      "No regressions in existing tests.",
    ];

    for (const text of testCases) {
      const parsed = parseSpec(`# Title\n\n## Acceptance criteria\n\n- [ ] ${text}\n`);
      expect(parsed.acceptanceCriteria[0]?.humanOnly).toBe(false);
    }
  });

  test("handles mixed automated and human-only criteria", () => {
    const content = `# Title

## Acceptance criteria

- [ ] The build passes.
- [ ] Feature works in the live iOS simulator. (Manual)
- [ ] Tests remain green.
- [ ] No visual regressions. visual inspection only`;

    const parsed = parseSpec(content);
    expect(parsed.acceptanceCriteria).toEqual([
      { checked: false, text: "The build passes.", humanOnly: false },
      { checked: false, text: "Feature works in the live iOS simulator. (Manual)", humanOnly: true },
      { checked: false, text: "Tests remain green.", humanOnly: false },
      { checked: false, text: "No visual regressions. visual inspection only", humanOnly: true },
    ]);
  });
});

describe("unsatisfiable AC detection", () => {
  test("flags non-human-only ACs asserting PR body content", () => {
    const unsatisfiable = [
      { checked: false, text: "PR body lists the breaking changes", humanOnly: false },
      { checked: false, text: "PR title states the feature name", humanOnly: false },
      { checked: false, text: "Pull request body describes the motivation", humanOnly: false },
      { checked: false, text: "PR body and title both state the change", humanOnly: false },
    ];

    for (const ac of unsatisfiable) {
      expect(isUnsatisfiableAc(ac)).toBe(true);
    }
  });

  test("flags non-human-only ACs asserting CI/check status", () => {
    const unsatisfiable = [
      { checked: false, text: "CI is green", humanOnly: false },
      { checked: false, text: "All checks pass", humanOnly: false },
      { checked: false, text: "The CI status passes", humanOnly: false },
      { checked: false, text: "GitHub actions workflow succeeds", humanOnly: false },
      { checked: false, text: "Workflow passes", humanOnly: false },
      { checked: false, text: "The green CI validates the change", humanOnly: false },
    ];

    for (const ac of unsatisfiable) {
      expect(isUnsatisfiableAc(ac)).toBe(true);
    }
  });

  test("flags non-human-only ACs asserting review/ready state", () => {
    const unsatisfiable = [
      { checked: false, text: "PR is ready", humanOnly: false },
      { checked: false, text: "Review state is approved", humanOnly: false },
      { checked: false, text: "The ready gate passes", humanOnly: false },
      { checked: false, text: "Review passes", humanOnly: false },
    ];

    for (const ac of unsatisfiable) {
      expect(isUnsatisfiableAc(ac)).toBe(true);
    }
  });

  test("exempts human-only ACs even if text asserts GitHub facts", () => {
    const humanOnly = [
      { checked: false, text: "CI is green. (Manual)", humanOnly: true },
      { checked: false, text: "PR body looks good. visual inspection only", humanOnly: true },
      { checked: false, text: "Review state verified. no automated guard", humanOnly: true },
    ];

    for (const ac of humanOnly) {
      expect(isUnsatisfiableAc(ac)).toBe(false);
    }
  });

  test("does not flag satisfiable ACs about operator behavior", () => {
    const satisfiable = [
      { checked: false, text: "Implementation correctly handles the edge case", humanOnly: false },
      { checked: false, text: "Tests pass when the feature is enabled", humanOnly: false },
      { checked: false, text: "The command runs without errors", humanOnly: false },
      { checked: false, text: "`spec-parser.test.ts` stays green", humanOnly: false },
    ];

    for (const ac of satisfiable) {
      expect(isUnsatisfiableAc(ac)).toBe(false);
    }
  });

  test("is case-insensitive", () => {
    const uppercase = { checked: false, text: "CI IS GREEN", humanOnly: false };
    const lowercase = { checked: false, text: "ci is green", humanOnly: false };
    const mixedcase = { checked: false, text: "CI Is Green", humanOnly: false };

    expect(isUnsatisfiableAc(uppercase)).toBe(true);
    expect(isUnsatisfiableAc(lowercase)).toBe(true);
    expect(isUnsatisfiableAc(mixedcase)).toBe(true);
  });

  test("warns during parseSpec when unsatisfiable ACs are found", () => {
    const content = `# Title

## Acceptance criteria

- [ ] CI is green
- [ ] Implementation works correctly`;

    const parsed = parseSpec(content);
    const unsatWarnings = parsed.warnings.filter((w) => w.kind === "unsatisfiable-acceptance-criterion");

    expect(unsatWarnings).toHaveLength(1);
    expect(unsatWarnings[0]?.message).toContain("CI is green");
  });

  test("parseSpec with mixed satisfiable and unsatisfiable ACs warns only on unsatisfiable ones", () => {
    const content = `# Title

## Acceptance criteria

- [ ] Tests pass
- [ ] PR body lists breaking changes
- [ ] The feature works correctly
- [ ] CI is green`;

    const parsed = parseSpec(content);
    const unsatWarnings = parsed.warnings.filter((w) => w.kind === "unsatisfiable-acceptance-criterion");

    expect(unsatWarnings).toHaveLength(2);
    expect(unsatWarnings.some((w) => w.message.includes("PR body lists"))).toBe(true);
    expect(unsatWarnings.some((w) => w.message.includes("CI is green"))).toBe(true);
  });
});
