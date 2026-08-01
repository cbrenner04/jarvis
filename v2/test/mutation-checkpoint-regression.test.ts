import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { verifyMutationCheckpoints } from "../src/execution/mutation-checkpoint-verifier.ts";

/**
 * Regression evidence: checkpoints that shipped ticked on 2026-08-01 while the
 * mutation they named turned nothing red, plus one checkpoint that shares no
 * identifier, path, or pin title with them.
 *
 * Rows 1-2 are historical failures replayed from their merge SHAs, re-expressed as
 * `@mutate` directives. Row 3 is the generality guard — the verifier must handle a
 * shape it was never shown. All directive text lives here, in fixture data, never
 * in verifier source.
 */
type RegressionRow = {
  label: string;
  /** Commit the production file is read from; the generality row reads current source. */
  sourceRef: string | undefined;
  productionPath: string;
  testPath: string;
  pinTitle: string;
  originalText: string;
  replacementText: string;
  /** True when the historical mutation left the suite green (hollow). */
  expectHollow: boolean;
};

const REPO_ROOT = join(import.meta.dir, "..", "..");

const ROWS: RegressionRow[] = [
  {
    label: "row 1 — measured terminal dims dropped on setState (#2473)",
    sourceRef: "56cfcff8",
    productionPath: "v2/src/tui/tui-entry.tsx",
    testPath: "v2/src/tui/tui-entry.test.tsx",
    pinTitle: "aligns selectable node ids with left-pane tree rows for the measured terminal size",
    originalText: "currentState = withMeasuredTerminal(state, terminalSizeFn);",
    replacementText: "currentState = state;",
    expectHollow: true,
  },
  {
    // The historical checkpoint named "reintroducing ids[0] fallthrough". Neutering the
    // guard that suppresses it is that mutation, expressed on one line.
    label: "row 2 — ids[0] fallthrough reintroduced in selectNextRun (#2485)",
    sourceRef: "1f75bad7",
    productionPath: "v2/src/tui/tui-entry.tsx",
    testPath: "v2/src/tui/tui-entry.test.tsx",
    pinTitle: "overflow fixture forward j then k retraces the exact reverse visit order",
    originalText: "if (activeId !== null) {",
    replacementText: "if (false) {",
    expectHollow: true,
  },
  {
    // Generality: a non-TUI production file, a pin title, a path, and an edit that
    // appear nowhere in the rows above. A verifier fitted to them cannot pass this.
    label: "row 3 — generality guard, unrelated surface",
    sourceRef: undefined,
    productionPath: "v2/src/execution/mutation-checkpoint-verifier.ts",
    testPath: "v2/src/execution/mutation-checkpoint-verifier.test.ts",
    pinTitle: "a malformed directive is reported, not silently dropped",
    originalText: 'const DIRECTIVE_MARKER = "@mutate";',
    replacementText: 'const DIRECTIVE_MARKER = "@no-such-marker";',
    expectHollow: false,
  },
];

/**
 * The third 2026-08-01 hollow checkpoint — "selection-driven list collapse" — has no
 * fixture: the line it named (`monitorLeftPaneTreeRows({ ...state, selectedNodeId: null }, …)`)
 * was dropped during review of #2473 and never reached a merge SHA, so there is nothing
 * to replay. Recorded here rather than approximated, because a fixture that does not
 * reproduce the original code proves nothing about the original failure.
 */

function fileAtRef(ref: string | undefined, path: string): string | undefined {
  // No ref means "as it stands now" — read the working tree so the generality row
  // covers current source rather than the last commit.
  if (ref === undefined) {
    try {
      return readFileSync(join(REPO_ROOT, path), "utf8");
    } catch {
      return undefined;
    }
  }
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], { cwd: REPO_ROOT, encoding: "utf8" });
  } catch {
    return undefined;
  }
}

function writeAt(root: string, relPath: string, content: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

/**
 * Materialize one row as a minimal worktree: the production file at its historical
 * content, a test file carrying the directive under the named pin, and a subspec
 * with a synthetic ticked criterion naming that pin.
 */
function materialize(row: RegressionRow): { root: string; ok: boolean } {
  const production = fileAtRef(row.sourceRef, row.productionPath);
  if (production === undefined || !production.includes(row.originalText)) return { root: "", ok: false };

  const root = mkdtempSync(join(tmpdir(), "mutation-checkpoint-regression-"));
  writeAt(root, row.productionPath, production);
  writeAt(
    root,
    row.testPath,
    [
      `test(${JSON.stringify(row.pinTitle)}, () => {`,
      `  // @mutate ${row.productionPath} ${JSON.stringify(row.originalText)} -> ${JSON.stringify(row.replacementText)}`,
      "});",
    ].join("\n"),
  );
  writeAt(
    root,
    "spec/00.md",
    [
      "# Regression",
      "",
      "## Acceptance criteria",
      "",
      `- [x] \`${row.testPath}\` — \`${row.pinTitle}\`; Mutation checkpoint: named on that pin.`,
      "",
    ].join("\n"),
  );
  return { root, ok: true };
}

describe("mutation-checkpoint regression evidence", () => {
  for (const row of ROWS) {
    test(row.label, async () => {
      const { root, ok } = materialize(row);
      // A rewritten history or a moved production line invalidates the fixture rather
      // than the verifier; fail loudly instead of passing vacuously.
      expect(ok).toBe(true);

      // NOTE ON WHAT THIS PROVES. The scoped-suite verdict is injected, not observed:
      // running the real historical suites would mean materializing two full worktrees
      // and executing test:v2 twice, which is minutes per row. So these rows pin the
      // parts that are cheap and were actually wrong in the abandoned attempt —
      // the directive parses, links to the named pin, and resolves against real
      // historical source where its target text occurs exactly once — plus the
      // classification that follows from a given verdict. They do NOT re-observe the
      // 2026-08-01 survivals.
      const report = await verifyMutationCheckpoints(join(root), join(root, "spec/00.md"), {
        runScopedTests: async () => row.expectHollow,
      });

      expect(report.unparseable).toEqual([]);
      if (row.expectHollow) {
        expect(report.caught).toEqual([]);
        expect(report.hollow).toHaveLength(1);
        expect(report.hollow[0]?.directive?.targetPath).toBe(row.productionPath);
      } else {
        expect(report.hollow).toEqual([]);
        expect(report.caught).toHaveLength(1);
        expect(report.caught[0]?.targetPath).toBe(row.productionPath);
      }
    });
  }

  test("the verifier names nothing from the regression evidence", () => {
    const verifierPath = join(REPO_ROOT, "v2/src/execution/mutation-checkpoint-verifier.ts");
    expect(existsSync(verifierPath)).toBe(true);
    const source = readFileSync(verifierPath, "utf8");

    // Domain-blindness: special-casing any evidence row would show up here. The
    // generality row is excluded because its production file IS the verifier.
    // Paths, pin titles, and the original source text identify a row. The replacement
    // text is deliberately excluded: `if (false) {` is generic code, and forbidding it
    // would fail this test for reasons unrelated to domain blindness.
    const forbidden = ROWS.filter((row) => row.sourceRef !== undefined).flatMap((row) => [
      row.productionPath,
      row.testPath,
      row.pinTitle,
      row.originalText,
    ]);

    for (const token of forbidden) {
      expect(source).not.toContain(token);
    }
  });
});
