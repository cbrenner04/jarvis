import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SPEC_GUIDANCE = readFileSync(join(import.meta.dir, "..", "v1", "docs", "spec-guidance.md"), "utf8");
const MUTATION_CHECKPOINT_CRITERIA =
  SPEC_GUIDANCE.match(/### Mutation-checkpoint criteria\n([\s\S]*?)(?=\n### )/)?.[1] ?? "";

describe("spec-guidance § Mutation-checkpoint criteria", () => {
  test("documents enclosing test() title requirement, linker matching, and hollow-on-loose-reference", () => {
    expect(MUTATION_CHECKPOINT_CRITERIA).toContain("enclosing `test()` title");
    expect(MUTATION_CHECKPOINT_CRITERIA).toMatch(/pin title\s*\/\s*`directive\.pinTitle`/);
    expect(MUTATION_CHECKPOINT_CRITERIA).toMatch(/every mutation-checkpoint criterion must include/i);
    expect(MUTATION_CHECKPOINT_CRITERIA).toContain("criterionText.includes(directive.pinTitle)");
    expect(MUTATION_CHECKPOINT_CRITERIA).toMatch(/case-sensitive/i);
    expect(MUTATION_CHECKPOINT_CRITERIA).toMatch(/substring of the full title suffices/i);
    expect(MUTATION_CHECKPOINT_CRITERIA).toMatch(/no all-directives-in-file fallback|no fallback/i);
    expect(MUTATION_CHECKPOINT_CRITERIA).toMatch(/different casing does not/i);
    expect(MUTATION_CHECKPOINT_CRITERIA).toMatch(/loose references/i);
    expect(MUTATION_CHECKPOINT_CRITERIA).toMatch(/`hollow`/);
    expect(MUTATION_CHECKPOINT_CRITERIA).toMatch(/Bad:/i);
    expect(MUTATION_CHECKPOINT_CRITERIA).toMatch(/Good:/i);
    expect(MUTATION_CHECKPOINT_CRITERIA).toContain("on the pinned-argv test in `write.test.ts`");
    expect(MUTATION_CHECKPOINT_CRITERIA).toContain("pinned argv passes through unchanged");
  });

  test("documents inside-the-test-body placement and adjacent-line above-test tolerance", () => {
    expect(MUTATION_CHECKPOINT_CRITERIA).toMatch(/inside the enclosing test body/i);
    expect(MUTATION_CHECKPOINT_CRITERIA).toMatch(/below the `test\("…", …\) => \{` line/i);
    expect(MUTATION_CHECKPOINT_CRITERIA).toMatch(/line immediately above the `test`\/`it` declaration/i);
    expect(MUTATION_CHECKPOINT_CRITERIA).toMatch(/next physical line/i);
    expect(MUTATION_CHECKPOINT_CRITERIA).toMatch(/verifier-tolerated/i);
    expect(MUTATION_CHECKPOINT_CRITERIA).toMatch(/inside-the-body is preferred/i);
  });
});
