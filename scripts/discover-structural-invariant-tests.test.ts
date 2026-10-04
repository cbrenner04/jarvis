import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyStructuralInvariantTestFile,
  discoverStructuralInvariantTests,
} from "./discover-structural-invariant-tests.ts";

// Which rule catches a given file is incidental — rule evaluation order can change without the
// guarantee changing. What must hold is that each file is selected by some rule rather than by a
// path allowlist, so these are asserted in-scope with a named rule, not a pinned one.
const SEED_EXAMPLE_FILES: readonly string[] = [
  "src/execution/execution-terminal-settlement-guard.test.ts",
  "src/daemon/daemon-test-inventory.test.ts",
  "src/execution/workflow-runner-resume-inventory.test.ts",
  "src/execution/workflow-runner-resume-structure.test.ts",
  "src/execution/diff-derived-mutation-verifier.test.ts",
  "src/daemon/daemon-workflow-start.test.ts",
  "src/shared/module-boundary-surfaces.test.ts",
];

// Reads its production path through a variable (`readFileSync(sourcePath, "utf8")`) and mirrors a
// production registry under a plural name. Both shapes were missed by the first implementation,
// which required a literal production path inside the call text and an exact `BASELINE` suffix.
const COMPUTED_PATH_READ_FILE = "src/shared/prompts/review-implement-growth-budget.test.ts";

describe("discover structural invariant tests", () => {
  test("discovery emits in-scope for a source-reading test file", () => {
    const source = `import { readFileSync } from "node:fs";
import { join } from "node:path";
const source = readFileSync(join(import.meta.dir, "workflow-runner.ts"), "utf8");
test("reads production source", () => {
  expect(source.length).toBeGreaterThan(0);
});`;
    expect(classifyStructuralInvariantTestFile("src/execution/example.test.ts", source)).toEqual({
      "test-path": "src/execution/example.test.ts",
      scope: "in-scope",
      rule: "source-read",
    });
  });

  test("discovery emits in-scope for a registry-mirroring test file", () => {
    const source = `const PERMITTED_HANDLERS = [
  { file: "daemon.ts", handler: "handleWorkflowStart" },
];
test("inventory mirrors production routing", () => {
  expect(PERMITTED_HANDLERS).toHaveLength(1);
});`;
    expect(classifyStructuralInvariantTestFile("src/daemon/example.test.ts", source)).toEqual({
      "test-path": "src/daemon/example.test.ts",
      scope: "in-scope",
      rule: "registry-mirror",
    });
  });

  test("discovery emits out-of-scope for a purely behavioral test file", () => {
    const source = `import { expect, test } from "bun:test";
import { add } from "./math.ts";
test("adds numbers", () => {
  expect(add(1, 2)).toBe(3);
});`;
    expect(classifyStructuralInvariantTestFile("src/shared/math.test.ts", source)).toEqual({
      "test-path": "src/shared/math.test.ts",
      scope: "out-of-scope",
      rule: "no-structural-signal",
    });
  });

  test("discovery classifies every seed example file in-scope by rule", () => {
    const scriptSource = readFileSync(join(import.meta.dir, "discover-structural-invariant-tests.ts"), "utf8");
    for (const testPath of SEED_EXAMPLE_FILES) {
      expect(scriptSource.includes(`"${testPath}"`)).toBe(false);
      expect(scriptSource.includes(`'${testPath}'`)).toBe(false);
    }

    const rows = discoverStructuralInvariantTests(process.cwd());
    const byPath = new Map(rows.map((row) => [row["test-path"], row]));
    for (const testPath of SEED_EXAMPLE_FILES) {
      const row = byPath.get(testPath);
      expect(row?.scope).toBe("in-scope");
      expect(row?.rule).not.toBe("no-structural-signal");
    }
  });

  test("discovery emits in-scope for a corpus file whose read path is a variable", () => {
    const rows = discoverStructuralInvariantTests(process.cwd());
    const row = rows.find((candidate) => candidate["test-path"] === COMPUTED_PATH_READ_FILE);
    expect(row?.scope).toBe("in-scope");
    expect(row?.rule).not.toBe("no-structural-signal");
  });
});
