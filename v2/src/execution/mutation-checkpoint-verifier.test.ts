import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { MutationCheckpointReport, UnparseableDirective } from "./mutation-checkpoint-verifier.ts";
import {
  describeHollow,
  describeUnparseable,
  isStrandedMutationContent,
  parseMutateDirectives,
  pinningTestReferenceFromCriterion,
  scopeForTarget,
  verifyMutationCheckpoints,
} from "./mutation-checkpoint-verifier.ts";

const REPO_ROOT = join(import.meta.dir, "../../..");
const EMPTY_CHECKPOINT_REPORT: MutationCheckpointReport = {
  hollow: [],
  unparseable: [],
  caught: [],
  unrestored: [],
  openedPinningFiles: [],
};
const GUARD_SOURCE = "export const ok = (a: number) => a > 0;\n";

function makeWorktree(): string {
  return mkdtempSync(join(tmpdir(), "mutation-checkpoint-"));
}

function writeAt(root: string, relPath: string, content: string): string {
  const full = join(root, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
  return full;
}

/** A subspec with one ticked criterion naming `<pinFile>` and the given pin title. */
function subspecNaming(pinFile: string, pinTitle: string): string {
  return [
    "# Spec",
    "",
    "## Acceptance criteria",
    "",
    `- [x] \`${pinFile}\` — \`${pinTitle}\`; Mutation checkpoint: named on that pin.`,
    "",
  ].join("\n");
}

function subspecWithCriteria(criteria: readonly string[]): string {
  return ["# Spec", "", "## Acceptance criteria", "", ...criteria, ""].join("\n");
}

function writeGuardMutatePin(root: string, relTestPath: string, pinTitle: string) {
  writeAt(root, "v2/src/guard.ts", GUARD_SOURCE);
  writeAt(
    root,
    relTestPath,
    [`test("${pinTitle}", () => {`, '  // @mutate v2/src/guard.ts "a > 0" -> "a >= 0"', "});"].join("\n"),
  );
}

function guardPinFixture(root: string, pinTitle: string, original = GUARD_SOURCE) {
  const target = writeAt(root, "v2/src/guard.ts", original);
  writeGuardMutatePin(root, "v2/src/guard.test.ts", pinTitle);
  return { target, original, subspec: writeAt(root, "spec/00.md", subspecNaming("guard.test.ts", pinTitle)) };
}

function expectSingleCatch(report: MutationCheckpointReport) {
  expect(report.unparseable).toEqual([]);
  expect(report.hollow).toEqual([]);
  expect(report.caught).toHaveLength(1);
}

/** Records the scoped-suite calls and answers with a caller-supplied verdict. */
function scopedRunner(passes: boolean): {
  run: (cwd: string, scope: string[]) => Promise<boolean>;
  calls: string[][];
} {
  const calls: string[][] = [];
  return {
    calls,
    run: async (_cwd, scope) => {
      calls.push(scope);
      return passes;
    },
  };
}

describe("parseMutateDirectives", () => {
  test("parses path, original, replacement, and enclosing pin title", () => {
    const content = [
      'test("some pin title", () => {',
      '  // @mutate v2/src/thing.ts "a === b" -> "a !== b"',
      "});",
    ].join("\n");

    const { directives, unparseable } = parseMutateDirectives("/wt/x.test.ts", content);

    expect(unparseable).toEqual([]);
    expect(directives).toHaveLength(1);
    expect(directives[0]?.targetPath).toBe("v2/src/thing.ts");
    expect(directives[0]?.originalText).toBe("a === b");
    expect(directives[0]?.replacementText).toBe("a !== b");
    expect(directives[0]?.pinTitle).toBe("some pin title");
    expect(directives[0]?.sourceLine).toBe(2);
  });

  test("a directive with no enclosing pin has an undefined title", () => {
    const { directives } = parseMutateDirectives("/wt/x.test.ts", '// @mutate a.ts "x" -> "y"');
    expect(directives[0]?.pinTitle).toBeUndefined();
  });

  test("escaped quotes survive into the target text", () => {
    const { directives } = parseMutateDirectives("/wt/x.test.ts", '// @mutate a.ts "say \\"hi\\"" -> "silent"');
    expect(directives[0]?.originalText).toBe('say "hi"');
  });

  test("a malformed directive is reported, not silently dropped", () => {
    const { directives, unparseable } = parseMutateDirectives("/wt/x.test.ts", "// @mutate missing quotes here");
    expect(directives).toEqual([]);
    expect(unparseable[0]?.reason).toBe("malformed");
    expect(unparseable[0]?.sourceLine).toBe(1);
  });

  test("string literals containing @mutate produce no unparseable entries", () => {
    const content = ['test("pin", () => {', '  const hint = "mention @mutate in prose";', "});"].join("\n");
    const { directives, unparseable } = parseMutateDirectives("/wt/x.test.ts", content);
    expect(directives).toEqual([]);
    expect(unparseable).toEqual([]);
  });
});

describe("pinningTestReferenceFromCriterion", () => {
  test("takes the first backticked segment that names a test file", () => {
    expect(pinningTestReferenceFromCriterion("`spec.md` then `a/b/thing.test.ts` — pin")).toBe("a/b/thing.test.ts");
  });

  test("returns undefined when no backticked segment names a test file", () => {
    expect(pinningTestReferenceFromCriterion("`src/thing.ts` — no pin named")).toBeUndefined();
  });

  test("basename is derivable from the first backticked test reference", () => {
    const reference = pinningTestReferenceFromCriterion("`spec.md` then `a/b/thing.test.ts` — pin");
    expect(reference !== undefined ? basename(reference) : undefined).toBe("thing.test.ts");
  });
});

describe("verifyMutationCheckpoints", () => {
  test("directive-only criteria receive caught and hollow verification", async () => {
    // @mutate v2/src/execution/mutation-checkpoint-verifier.ts "markerSource.includes(CRITERION_MARKER) || DIRECTIVE_PATTERN.test(markerSource)" -> "markerSource.includes(CRITERION_MARKER)"
    for (const passes of [true, false]) {
      const root = makeWorktree();
      writeAt(root, "v2/src/guard.ts", "export const ok = (a: number) => a > 0;\n");
      writeAt(
        root,
        "v2/src/guard.test.ts",
        ['test("guard pin", () => {', '  // @mutate v2/src/guard.ts "a > 0" -> "a >= 0"', "});"].join("\n"),
      );
      const subspec = writeAt(
        root,
        "spec/00.md",
        subspecWithCriteria([
          '- [x] `guard.test.ts` — `guard pin`; // @mutate v2/src/guard.ts "a > 0" -> "a >= 0" evidence.',
        ]),
      );

      const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: scopedRunner(passes).run });

      expect(report[passes ? "caught" : "hollow"]).toEqual([]);
      expect(report[passes ? "hollow" : "caught"]).toHaveLength(1);
      if (passes) {
        const hollow = report.hollow[0];
        if (!hollow) throw new Error("expected a hollow checkpoint");
        expect(describeHollow(hollow)).toMatch(/guard\.test\.ts:\d+: .*@mutate/);
      }
    }
  });

  test("a directive-only criterion linking no directive is hollow", async () => {
    const root = makeWorktree();
    writeAt(root, "v2/src/guard.test.ts", 'test("guard pin", () => {});');
    const subspec = writeAt(
      root,
      "spec/00.md",
      subspecWithCriteria([
        '- [x] `guard.test.ts` — `guard pin`; // @mutate v2/src/guard.ts "a > 0" -> "a >= 0" requires evidence.',
      ]),
    );

    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: scopedRunner(false).run });

    expect(report.hollow).toHaveLength(1);
    expect(report.hollow[0]?.directive).toBeUndefined();
    const hollow = report.hollow[0];
    if (!hollow) throw new Error("expected a hollow checkpoint");
    expect(describeHollow(hollow)).toContain('// @mutate <path> "<original>" -> "<replacement>"');
  });

  test("criteria without either marker are ignored", async () => {
    const root = makeWorktree();
    writeAt(root, "v2/src/guard.test.ts", 'test("guard pin", () => {});');
    const subspec = writeAt(
      root,
      "spec/00.md",
      subspecWithCriteria([
        "- [x] `guard.test.ts` — `guard pin` has ordinary coverage.",
        "- [x] `guard.test.ts` — `guard pin` discusses mutation testing in prose.",
      ]),
    );

    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: scopedRunner(true).run });

    expect(report).toEqual(EMPTY_CHECKPOINT_REPORT);
  });

  test("unticked and human-only directive markers are ignored", async () => {
    const root = makeWorktree();
    writeAt(root, "v2/src/guard.test.ts", 'test("guard pin", () => {});');
    const subspec = writeAt(
      root,
      "spec/00.md",
      subspecWithCriteria([
        "- [ ] `guard.test.ts` — `guard pin` links `@mutate` evidence.",
        "- [x] `guard.test.ts` — `guard pin` links `@mutate` evidence. (Manual)",
      ]),
    );

    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: scopedRunner(true).run });

    expect(report).toEqual(EMPTY_CHECKPOINT_REPORT);
  });

  test("continuation-line markers cannot bypass verification", async () => {
    const root = makeWorktree();
    writeAt(root, "v2/src/guard.ts", "export const ok = (a: number) => a > 0;\n");
    writeAt(
      root,
      "v2/src/guard.test.ts",
      ['test("guard pin", () => {', '  // @mutate v2/src/guard.ts "a > 0" -> "a >= 0"', "});"].join("\n"),
    );
    const subspec = writeAt(
      root,
      "spec/00.md",
      subspecWithCriteria([
        "- [x] `guard.test.ts` — `guard pin` is checked.",
        "  Mutation checkpoint: continuation evidence.",
        "- [x] `guard.test.ts` — `guard pin` is checked.",
        '  // @mutate v2/src/guard.ts "a > 0" -> "a >= 0" continuation evidence.',
      ]),
    );

    const runner = scopedRunner(true);
    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: runner.run });

    expect(report.caught).toEqual([]);
    expect(report.unparseable).toEqual([]);
    expect(report.hollow).toHaveLength(2);
    expect(runner.calls).toHaveLength(2);
  });

  test("wrapped pinning-test reference on continuation line resolves and catches", async () => {
    // @mutate v2/src/execution/mutation-checkpoint-verifier.ts "resolvePinningTestPath(worktreeRoot, block)" -> "resolvePinningTestPath(worktreeRoot, criterionText)"
    const root = makeWorktree();
    writeGuardMutatePin(root, "v2/src/wrapped-pin.test.ts", "wrapped pin");
    const subspec = writeAt(
      root,
      "spec/00.md",
      subspecWithCriteria([
        "- [x] Mutation checkpoint: pinning test on continuation.",
        "  `wrapped-pin.test.ts` — `wrapped pin`",
      ]),
    );

    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: scopedRunner(false).run });

    expectSingleCatch(report);
  });

  test("wrapped enclosing-test name on continuation line links directive", async () => {
    const root = makeWorktree();
    writeGuardMutatePin(root, "v2/src/guard.test.ts", "wrapped pin");
    const subspec = writeAt(
      root,
      "spec/00.md",
      subspecWithCriteria([
        "- [x] `guard.test.ts` — Mutation checkpoint: pin name on continuation.",
        "  `wrapped pin`",
      ]),
    );

    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: scopedRunner(false).run });

    expectSingleCatch(report);
  });

  test("a directive whose mutation turns the suite red is caught", async () => {
    const root = makeWorktree();
    writeAt(root, "v2/src/guard.ts", "export const ok = (a: number) => a > 0;\n");
    writeAt(
      root,
      "v2/src/guard.test.ts",
      ['test("guard pin", () => {', '  // @mutate v2/src/guard.ts "a > 0" -> "a >= 0"', "});"].join("\n"),
    );
    const subspec = writeAt(root, "spec/00.md", subspecNaming("guard.test.ts", "guard pin"));
    const runner = scopedRunner(false);

    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: runner.run });

    expect(report.hollow).toEqual([]);
    expect(report.caught).toHaveLength(1);
    expect(report.caught[0]?.targetPath).toBe("v2/src/guard.ts");
    expect(runner.calls).toEqual([["test:v2", "test:integration:v2"]]);
  });

  test("a directive whose mutation leaves the suite green is hollow", async () => {
    const root = makeWorktree();
    writeAt(root, "v2/src/guard.ts", "export const ok = (a: number) => a > 0;\n");
    writeAt(
      root,
      "v2/src/guard.test.ts",
      ['test("guard pin", () => {', '  // @mutate v2/src/guard.ts "a > 0" -> "a >= 0"', "});"].join("\n"),
    );
    const subspec = writeAt(root, "spec/00.md", subspecNaming("guard.test.ts", "guard pin"));

    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: scopedRunner(true).run });

    expect(report.caught).toEqual([]);
    expect(report.hollow).toHaveLength(1);
    const hollow = report.hollow[0];
    if (!hollow) throw new Error("expected a hollow checkpoint");
    expect(describeHollow(hollow)).toContain("scoped suite stayed green");
  });

  test("the target file is restored after the mutation is applied", async () => {
    const root = makeWorktree();
    const original = "export const ok = (a: number) => a > 0;\n";
    const target = writeAt(root, "v2/src/guard.ts", original);
    writeAt(
      root,
      "v2/src/guard.test.ts",
      ['test("guard pin", () => {', '  // @mutate v2/src/guard.ts "a > 0" -> "a >= 0"', "});"].join("\n"),
    );
    const subspec = writeAt(root, "spec/00.md", subspecNaming("guard.test.ts", "guard pin"));
    let sawMutation = false;

    await verifyMutationCheckpoints(root, subspec, {
      runScopedTests: async () => {
        sawMutation = readFileSync(target, "utf8").includes("a >= 0");
        return false;
      },
    });

    expect(sawMutation).toBe(true);
    expect(readFileSync(target, "utf8")).toBe(original);
  });

  test("the target file is restored even when the scoped runner throws", async () => {
    const root = makeWorktree();
    const original = "export const ok = (a: number) => a > 0;\n";
    const target = writeAt(root, "v2/src/guard.ts", original);
    writeAt(
      root,
      "v2/src/guard.test.ts",
      ['test("guard pin", () => {', '  // @mutate v2/src/guard.ts "a > 0" -> "a >= 0"', "});"].join("\n"),
    );
    const subspec = writeAt(root, "spec/00.md", subspecNaming("guard.test.ts", "guard pin"));

    await expect(
      verifyMutationCheckpoints(root, subspec, {
        runScopedTests: async () => {
          throw new Error("suite exploded");
        },
      }),
    ).rejects.toThrow("suite exploded");

    expect(readFileSync(target, "utf8")).toBe(original);
  });

  test("a ticked criterion linking no directive is hollow and names the required form", async () => {
    const root = makeWorktree();
    writeAt(root, "v2/src/guard.ts", "export const ok = (a: number) => a > 0;\n");
    // A prose checkpoint comment, exactly as written before this contract existed.
    writeAt(
      root,
      "v2/src/guard.test.ts",
      ['test("guard pin", () => {', "  // Mutation checkpoint: flipping `a > 0` turns this RED.", "});"].join("\n"),
    );
    const subspec = writeAt(root, "spec/00.md", subspecNaming("guard.test.ts", "guard pin"));

    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: scopedRunner(false).run });

    expect(report.hollow).toHaveLength(1);
    expect(report.hollow[0]?.directive).toBeUndefined();
    const hollow = report.hollow[0];
    if (!hollow) throw new Error("expected a hollow checkpoint");
    expect(describeHollow(hollow)).toContain("@mutate");
  });

  test("every linked directive is applied, so one hollow among several still refuses", async () => {
    const root = makeWorktree();
    writeAt(root, "v2/src/guard.ts", "export const ok = (a: number) => a > 0;\nexport const two = 2;\n");
    writeAt(
      root,
      "v2/src/guard.test.ts",
      [
        'test("guard pin", () => {',
        '  // @mutate v2/src/guard.ts "a > 0" -> "a >= 0"',
        '  // @mutate v2/src/guard.ts "two = 2" -> "two = 3"',
        "});",
      ].join("\n"),
    );
    const subspec = writeAt(root, "spec/00.md", subspecNaming("guard.test.ts", "guard pin"));
    let call = 0;

    const report = await verifyMutationCheckpoints(root, subspec, {
      runScopedTests: async () => {
        call += 1;
        return call === 2; // second mutation survives
      },
    });

    expect(report.caught).toHaveLength(1);
    expect(report.hollow).toHaveLength(1);
    expect(report.hollow[0]?.directive?.originalText).toBe("two = 2");
  });

  test("prose @mutate without a directive-shaped occurrence is not selected", async () => {
    // @mutate v2/src/execution/mutation-checkpoint-verifier.ts "DIRECTIVE_PATTERN.test(markerSource)" -> "markerSource.includes(DIRECTIVE_MARKER)"
    const root = makeWorktree();
    writeAt(root, "v2/src/guard.test.ts", 'test("guard pin", () => {});');
    const subspec = writeAt(
      root,
      "spec/00.md",
      subspecWithCriteria(["- [x] `guard.test.ts` — `guard pin` discusses the `@mutate` marker in prose."]),
    );

    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: scopedRunner(true).run });

    expect(report.hollow).toEqual([]);
    expect(report.caught).toEqual([]);
    expect(report.unparseable).toEqual([]);
  });

  test("a ticked criterion quoting a directive-shaped @mutate occurrence is still verified", async () => {
    const root = makeWorktree();
    writeAt(root, "v2/src/guard.ts", "export const ok = (a: number) => a > 0;\n");
    writeAt(
      root,
      "v2/src/guard.test.ts",
      ['test("guard pin", () => {', '  // @mutate v2/src/guard.ts "a > 0" -> "a >= 0"', "});"].join("\n"),
    );
    const subspec = writeAt(
      root,
      "spec/00.md",
      subspecWithCriteria([
        '- [x] `guard.test.ts` — `guard pin`; embeds // @mutate v2/src/guard.ts "a > 0" -> "a >= 0".',
      ]),
    );

    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: scopedRunner(false).run });

    expect(report.hollow).toEqual([]);
    expect(report.caught).toHaveLength(1);
  });

  test("no pin match inherits no directives", async () => {
    const root = makeWorktree();
    writeAt(root, "v2/src/guard.ts", "export const ok = (a: number) => a > 0;\nexport const two = 2;\n");
    writeAt(
      root,
      "v2/src/guard.test.ts",
      [
        'test("guard pin", () => {',
        '  // @mutate v2/src/guard.ts "a > 0" -> "a >= 0"',
        "});",
        'test("other pin", () => {',
        '  // @mutate v2/src/guard.ts "two = 2" -> "two = 3"',
        "});",
      ].join("\n"),
    );
    const subspec = writeAt(root, "spec/00.md", subspecNaming("guard.test.ts", "missing pin title"));

    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: scopedRunner(false).run });

    expect(report.caught).toEqual([]);
    expect(report.hollow).toHaveLength(1);
    expect(report.hollow[0]?.directive).toBeUndefined();
  });

  test("fixture subspec discussing @mutate in prose reports zero hollow entries", async () => {
    const fixture = join(
      REPO_ROOT,
      "v2/spec/completed/20260802T045701Z-verify-directive-only-mutation-criteria/00-verify-directive-only-mutation-criteria.md",
    );
    const report = await verifyMutationCheckpoints(REPO_ROOT, fixture, {
      runScopedTests: async () => false,
    });
    expect(report.hollow).toEqual([]);
  });

  test("only directives under a named pin are linked to that criterion", async () => {
    const root = makeWorktree();
    writeAt(root, "v2/src/guard.ts", "export const ok = (a: number) => a > 0;\nexport const two = 2;\n");
    writeAt(
      root,
      "v2/src/guard.test.ts",
      [
        'test("guard pin", () => {',
        '  // @mutate v2/src/guard.ts "a > 0" -> "a >= 0"',
        "});",
        'test("unrelated pin", () => {',
        '  // @mutate v2/src/guard.ts "two = 2" -> "two = 3"',
        "});",
      ].join("\n"),
    );
    const subspec = writeAt(root, "spec/00.md", subspecNaming("guard.test.ts", "guard pin"));

    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: scopedRunner(false).run });

    expect(report.caught).toHaveLength(1);
    expect(report.caught[0]?.originalText).toBe("a > 0");
  });

  test("unticked and human-only criteria are not verified", async () => {
    const root = makeWorktree();
    writeAt(root, "v2/src/guard.ts", "export const ok = (a: number) => a > 0;\n");
    writeAt(root, "v2/src/guard.test.ts", 'test("guard pin", () => {});');
    const subspec = writeAt(
      root,
      "spec/00.md",
      [
        "# Spec",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] `guard.test.ts` — `guard pin`; Mutation checkpoint: unticked.",
        "- [x] `guard.test.ts` — `guard pin`; Mutation checkpoint: manual. (Manual)",
        "",
      ].join("\n"),
    );

    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: scopedRunner(true).run });

    expect(report).toEqual(EMPTY_CHECKPOINT_REPORT);
  });

  describe("unparseable causes are reported from opened pinning files", () => {
    const cases: { name: string; directive: string; reason: UnparseableDirective["reason"] }[] = [
      { name: "malformed syntax", directive: "// @mutate nonsense", reason: "malformed" },
      {
        name: "unresolvable path",
        directive: '// @mutate v2/src/absent.ts "x" -> "y"',
        reason: "unresolvable_path",
      },
      {
        name: "target text absent",
        directive: '// @mutate v2/src/guard.ts "not present" -> "y"',
        reason: "target_absent",
      },
      {
        name: "target text ambiguous",
        directive: '// @mutate v2/src/guard.ts "dup" -> "y"',
        reason: "target_ambiguous",
      },
    ];

    for (const testCase of cases) {
      test(testCase.name, async () => {
        const root = makeWorktree();
        writeAt(root, "v2/src/guard.ts", "const a = 'dup';\nconst b = 'dup';\n");
        writeAt(
          root,
          "v2/src/guard.test.ts",
          ['test("guard pin", () => {', `  ${testCase.directive}`, "});"].join("\n"),
        );
        const subspec = writeAt(root, "spec/00.md", subspecNaming("guard.test.ts", "guard pin"));
        const reported: string[] = [];

        const report = await verifyMutationCheckpoints(root, subspec, {
          runScopedTests: scopedRunner(true).run,
          report: (message) => reported.push(message),
        });

        expect(report.unparseable.map((entry) => entry.reason)).toContain(testCase.reason);
        expect(reported.join("\n")).toContain(testCase.reason);
      });
    }
  });

  test("unresolved pinning test is reported", async () => {
    const root = makeWorktree();
    const subspec = writeAt(
      root,
      "spec/00.md",
      [
        "# Spec",
        "",
        "## Acceptance criteria",
        "",
        "- [x] `absent.test.ts` — `guard pin`; Mutation checkpoint: named.",
        "",
      ].join("\n"),
    );

    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: scopedRunner(true).run });

    expect(report.hollow).toEqual([]);
    const entry = report.unparseable[0];
    expect(entry?.reason).toBe("unresolved_pinning_test");
    expect(entry?.criterionText).toContain("absent.test.ts");
    expect(entry?.rawReference).toBe("absent.test.ts");
    if (entry === undefined) throw new Error("expected unparseable entry");
    expect(describeUnparseable(entry)).toContain("criterion:");
    expect(describeUnparseable(entry)).toContain("reference: absent.test.ts");
    expect(describeUnparseable(entry)).toContain("reason: unresolved_pinning_test");
  });

  test("ambiguous pinning-test basename is reported", async () => {
    const root = makeWorktree();
    writeAt(root, "v2/src/a/guard.test.ts", 'test("guard pin", () => {});');
    writeAt(root, "v2/src/b/guard.test.ts", 'test("guard pin", () => {});');
    const subspec = writeAt(root, "spec/00.md", subspecNaming("guard.test.ts", "guard pin"));

    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: scopedRunner(true).run });

    expect(report.hollow).toEqual([]);
    const entry = report.unparseable[0];
    expect(entry?.reason).toBe("unresolved_pinning_test");
    expect(entry?.criterionText).toContain("guard.test.ts");
    expect(entry?.rawReference).toBe("guard.test.ts");
    if (entry === undefined) throw new Error("expected unparseable entry");
    expect(describeUnparseable(entry)).toContain("criterion:");
    expect(describeUnparseable(entry)).toContain("reference: guard.test.ts");
    expect(describeUnparseable(entry)).toContain("reason: unresolved_pinning_test");
  });

  test("path-qualified pinning test resolves exactly", async () => {
    // @mutate v2/src/execution/mutation-checkpoint-verifier.ts "if (normalized.includes(\"/\"))" -> "if (false)"
    const root = makeWorktree();
    writeAt(root, "v2/src/commands/write.test.ts", 'test("commands pin", () => {});');
    writeAt(root, "v2/src/execution/guard.ts", "export const ok = (a: number) => a > 0;\n");
    writeAt(
      root,
      "v2/src/execution/write.test.ts",
      ['test("execution pin", () => {', '  // @mutate v2/src/execution/guard.ts "a > 0" -> "a >= 0"', "});"].join("\n"),
    );
    const subspec = writeAt(root, "spec/00.md", subspecNaming("v2/src/execution/write.test.ts", "execution pin"));
    const runner = scopedRunner(false);

    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: runner.run });

    expect(report.unparseable).toEqual([]);
    expect(report.hollow).toEqual([]);
    expect(report.caught).toHaveLength(1);
    expect(report.caught[0]?.targetPath).toBe("v2/src/execution/guard.ts");
    expect(runner.calls.length).toBeGreaterThan(0);
  });

  test("qualified path with no file does not fall back to basename", async () => {
    const root = makeWorktree();
    writeAt(
      root,
      "v2/src/execution/guard.test.ts",
      ['test("guard pin", () => {', '  // @mutate v2/src/execution/guard.ts "a > 0" -> "a >= 0"', "});"].join("\n"),
    );
    const subspec = writeAt(root, "spec/00.md", subspecNaming("v2/src/execution/absent.test.ts", "guard pin"));

    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: scopedRunner(true).run });

    expect(report.hollow).toEqual([]);
    expect(report.caught).toEqual([]);
    const entry = report.unparseable[0];
    expect(entry?.reason).toBe("unresolved_pinning_test");
    expect(entry?.rawReference).toBe("v2/src/execution/absent.test.ts");
  });

  test("single basename match still resolves", async () => {
    const root = makeWorktree();
    writeAt(root, "v2/src/guard.ts", "export const ok = (a: number) => a > 0;\n");
    writeAt(
      root,
      "v2/src/guard.test.ts",
      ['test("guard pin", () => {', '  // @mutate v2/src/guard.ts "a > 0" -> "a >= 0"', "});"].join("\n"),
    );
    const subspec = writeAt(root, "spec/00.md", subspecNaming("guard.test.ts", "guard pin"));
    const runner = scopedRunner(false);

    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: runner.run });

    expect(report.unparseable).toEqual([]);
    expect(report.hollow).toEqual([]);
    expect(report.caught).toHaveLength(1);
    expect(runner.calls.length).toBeGreaterThan(0);
  });

  test("path-qualified pinning fixture reports zero unparseable and two caught", async () => {
    const fixture = join(REPO_ROOT, "v2/src/execution/fixtures/path-qualified-pinning-subspec.md");
    const report = await verifyMutationCheckpoints(REPO_ROOT, fixture, {
      runScopedTests: async () => false,
    });
    expect(report.unparseable).toEqual([]);
    expect(report.caught).toHaveLength(2);
  });

  test("scoped suites follow the mutated file's surface, not the test file's", async () => {
    const root = makeWorktree();
    writeAt(root, "v1/src/legacy.ts", "export const ok = (a: number) => a > 0;\n");
    writeAt(
      root,
      "v2/src/legacy.test.ts",
      ['test("legacy pin", () => {', '  // @mutate v1/src/legacy.ts "a > 0" -> "a >= 0"', "});"].join("\n"),
    );
    const subspec = writeAt(root, "spec/00.md", subspecNaming("legacy.test.ts", "legacy pin"));
    const runner = scopedRunner(false);

    await verifyMutationCheckpoints(root, subspec, { runScopedTests: runner.run });

    expect(runner.calls).toEqual([["test:v1", "test:integration:v1"]]);
  });

  test("unparseable directives reach stderr when no sink is injected", async () => {
    // @mutate v2/src/execution/mutation-checkpoint-verifier.ts "const report = seams.report ??" -> "const report = seams.report ?? (() => {}) ??"
    const root = makeWorktree();
    writeAt(root, "v2/src/guard.ts", "export const ok = (a: number) => a > 0;\n");
    writeAt(root, "v2/src/guard.test.ts", ['test("guard pin", () => {', "  // @mutate nonsense", "});"].join("\n"));
    const subspec = writeAt(root, "spec/00.md", subspecNaming("guard.test.ts", "guard pin"));
    const written: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await verifyMutationCheckpoints(root, subspec, { runScopedTests: scopedRunner(true).run });
    } finally {
      process.stderr.write = original;
    }

    expect(written.join("")).toContain("malformed");
  });

  test("describeUnparseable names file, line, reason, and directive text", () => {
    expect(
      describeUnparseable({ sourceFile: "/wt/x.test.ts", sourceLine: 7, raw: "// @mutate bad", reason: "malformed" }),
    ).toBe("/wt/x.test.ts:7: malformed: // @mutate bad");
  });

  test("abort during verification restores pre-mutation bytes", async () => {
    // @mutate v2/src/execution/mutation-checkpoint-verifier.ts "restoreSnapshots(snapshots, io.writeFile);" -> ""
    const controller = new AbortController();
    const root = makeWorktree();
    const { target, original, subspec } = guardPinFixture(root, "abort pin");
    let subprocessKilled = false;
    let verificationStarted = false;
    const runner: AsyncSubprocessRunner = {
      async runAsync(_cmd, _args, _cwd, options) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 60_000);
          verificationStarted = true;
          options?.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              subprocessKilled = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        });
        return "";
      },
    };

    const verifyPromise = verifyMutationCheckpoints(root, subspec, {
      signal: controller.signal,
      remainingIterationWallMs: () => 60_000,
      runScopedTests: async (_cwd, scope, context) => {
        for (const script of scope) {
          await runner.runAsync("bun", ["run", script], _cwd, {
            ...(context?.timeoutMs !== undefined ? { timeoutMs: context.timeoutMs } : {}),
            ...(context?.signal !== undefined ? { signal: context.signal } : {}),
          });
        }
        return true;
      },
    });
    const deadline = Date.now() + 5_000;
    while (!verificationStarted && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    controller.abort();
    await expect(verifyPromise).rejects.toThrow("aborted");

    expect(subprocessKilled).toBe(true);
    expect(readFileSync(target, "utf8")).toBe(original);
  });

  test("scoped verification timeout terminates and restores", async () => {
    const root = makeWorktree();
    const { target, original, subspec } = guardPinFixture(root, "timeout pin");
    let subprocessKilled = false;
    const runner: AsyncSubprocessRunner = {
      async runAsync(_cmd, _args, _cwd, options) {
        await new Promise<void>((_resolve, reject) => {
          const timer = setTimeout(() => {
            subprocessKilled = true;
            reject(new Error("timeout"));
          }, options?.timeoutMs ?? 1);
          options?.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              subprocessKilled = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        });
        return "";
      },
    };

    await expect(
      verifyMutationCheckpoints(root, subspec, {
        remainingIterationWallMs: () => 5,
        asyncSubprocessRunner: runner,
      }),
    ).rejects.toThrow("timeout");

    expect(subprocessKilled).toBe(true);
    expect(readFileSync(target, "utf8")).toBe(original);
  });

  test("throw mid-directive restores from snapshot", async () => {
    const root = makeWorktree();
    const { target, original, subspec } = guardPinFixture(root, "throw pin");
    let runnerInvoked = false;

    await expect(
      verifyMutationCheckpoints(root, subspec, {
        runScopedTests: async () => {
          runnerInvoked = true;
          throw new Error("suite exploded");
        },
      }),
    ).rejects.toThrow("suite exploded");

    expect(runnerInvoked).toBe(true);
    expect(readFileSync(target, "utf8")).toBe(original);
  });

  test("a target classified full remaps to the aggregate test script", () => {
    const root = makeWorktree();
    // A root-tooling path classifies as "full"; the remap must name ["test"],
    // never an empty scope that would short-circuit verification to a pass.
    expect(scopeForTarget(root, join(root, "package.json"))).toEqual(["test"]);
  });

  test("an empty replacement is not flagged as stranded mutation content", () => {
    // Original absent and replacement empty: without the `replacementText.length > 0`
    // guard, `content.includes("")` would falsely flag every such directive.
    expect(
      isStrandedMutationContent("const enabled = false;\n", {
        originalText: "const enabled = true;",
        replacementText: "",
      }),
    ).toBe(false);
  });
});
