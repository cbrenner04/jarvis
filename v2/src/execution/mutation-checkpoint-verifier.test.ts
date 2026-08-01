import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UnparseableDirective } from "./mutation-checkpoint-verifier.ts";
import {
  describeHollow,
  describeUnparseable,
  parseMutateDirectives,
  pinningTestBasenameFromCriterion,
  verifyMutationCheckpoints,
} from "./mutation-checkpoint-verifier.ts";

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
});

describe("pinningTestBasenameFromCriterion", () => {
  test("takes the first backticked segment that names a test file", () => {
    expect(pinningTestBasenameFromCriterion("`spec.md` then `a/b/thing.test.ts` — pin")).toBe("thing.test.ts");
  });

  test("returns undefined when no backticked segment names a test file", () => {
    expect(pinningTestBasenameFromCriterion("`src/thing.ts` — no pin named")).toBeUndefined();
  });
});

describe("verifyMutationCheckpoints", () => {
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
    expect(describeHollow(report.hollow[0]!)).toContain("scoped suite stayed green");
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
    expect(describeHollow(report.hollow[0]!)).toContain("@mutate");
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

    expect(report).toEqual({ hollow: [], unparseable: [], caught: [] });
  });

  describe("unparseable causes are reported without refusing completion", () => {
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

  test("a criterion naming no resolvable pinning test is unparseable, not hollow", async () => {
    const root = makeWorktree();
    const subspec = writeAt(
      root,
      "spec/00.md",
      [
        "# Spec",
        "",
        "## Acceptance criteria",
        "",
        "- [x] no backticked pin here; Mutation checkpoint: named.",
        "",
      ].join("\n"),
    );

    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: scopedRunner(true).run });

    expect(report.hollow).toEqual([]);
    expect(report.unparseable[0]?.reason).toBe("unresolved_pinning_test");
  });

  test("an ambiguous pinning-test basename is unparseable, not hollow", async () => {
    const root = makeWorktree();
    writeAt(root, "v2/src/a/guard.test.ts", 'test("guard pin", () => {});');
    writeAt(root, "v2/src/b/guard.test.ts", 'test("guard pin", () => {});');
    const subspec = writeAt(root, "spec/00.md", subspecNaming("guard.test.ts", "guard pin"));

    const report = await verifyMutationCheckpoints(root, subspec, { runScopedTests: scopedRunner(true).run });

    expect(report.hollow).toEqual([]);
    expect(report.unparseable[0]?.reason).toBe("unresolved_pinning_test");
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
});
