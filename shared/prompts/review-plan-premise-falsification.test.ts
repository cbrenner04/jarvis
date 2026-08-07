import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectUnfalsifiablePremisesInMarkdown } from "../premise-falsification.ts";
import { buildPlanReviewPassContext, renderPlanReviewDebateRolePrompt } from "./review-plan.ts";

function specDirWithIntent(): string {
  const dir = mkdtempSync(join(tmpdir(), "plan-review-premise-"));
  writeFileSync(join(dir, "intent.md"), "# Intent\n", "utf8");
  return dir;
}

const PREMISE_SIGNAL = "no reachable violation on the repository base today";
const UNREACHABLE_INVARIANT = "- [ ] Neither destination may equal the predecessor worktree.";
const REACHABLE_PROSE =
  "- [ ] Neither destination may equal the predecessor worktree; constructible on main via fan-out dispatch.";
const REACHABLE_PRODUCTION_HOOK =
  "- [ ] `v2/src/dispatch.ts` where `resolveDestination` may return the predecessor worktree; neither destination may equal the predecessor worktree.";
const REACHABLE_TEST_PIN =
  "- [ ] `dispatch.test.ts` — `fan-out preserves ownership`; neither destination may equal the predecessor worktree.";
const ORDINARY_MUST_NOT = "- [ ] The handler must not leak sensitive data in error responses.";
const FAN_OUT_VERBATIM =
  "- [ ] Each sibling dispatch owns only its resolved destination `(project, branch)` worktree; neither destination may equal the predecessor worktree.";
const HOLLOW_CRITERION = '- [ ] `guard.test.ts`; // @mutate v2/src/guard.ts "a > 0" -> "a >= 0" requires a linked pin.';
const ADVERSARY_PREMISE_INSTRUCTION = "Unfalsifiable premises listed in Context under `## Unfalsifiable premises`";

describe("plan review premise-falsification pass", () => {
  test("flags an invariant criterion with no reachable violation on the base", () => {
    // @mutate shared/premise-falsification.ts "if (!isPremiseBearingCriterion(block)) continue" -> "if (false) continue"
    const markdown = ["# Spec", "", "## Acceptance criteria", "", UNREACHABLE_INVARIANT, ""].join("\n");
    const findings = detectUnfalsifiablePremisesInMarkdown(markdown);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.criterionText).toContain("may equal");
    expect(findings[0]?.rationale).toContain(PREMISE_SIGNAL);

    const specPath = specDirWithIntent();
    writeFileSync(
      join(specPath, "00-guard.md"),
      ["# Guard", "", "## Acceptance criteria", "", UNREACHABLE_INVARIANT, ""].join("\n"),
      "utf8",
    );
    const context = { worktreePath: "/repo", specPath };
    const passContext = buildPlanReviewPassContext(context);
    expect(passContext).toContain("## Unfalsifiable premises");
    expect(passContext).toContain(PREMISE_SIGNAL);
    expect(renderPlanReviewDebateRolePrompt("adversary", context)).toContain(PREMISE_SIGNAL);
    expect(renderPlanReviewDebateRolePrompt("adversary", context)).toContain(ADVERSARY_PREMISE_INSTRUCTION);
    expect(renderPlanReviewDebateRolePrompt("advocate", context, "prior")).toContain(PREMISE_SIGNAL);
  });

  test("does not flag invariant criteria whose violations are reachable on the base", () => {
    for (const criterion of [REACHABLE_PROSE, REACHABLE_PRODUCTION_HOOK, REACHABLE_TEST_PIN]) {
      const markdown = ["# Spec", "", "## Acceptance criteria", "", criterion, ""].join("\n");
      expect(detectUnfalsifiablePremisesInMarkdown(markdown)).toEqual([]);
    }

    const specPath = specDirWithIntent();
    writeFileSync(
      join(specPath, "00-guard.md"),
      ["# Guard", "", "## Acceptance criteria", "", REACHABLE_PROSE, ""].join("\n"),
      "utf8",
    );
    const context = { worktreePath: "/repo", specPath };
    expect(buildPlanReviewPassContext(context)).toBe("");
    expect(renderPlanReviewDebateRolePrompt("adversary", context)).not.toContain(PREMISE_SIGNAL);
  });

  test("does not flag ordinary behavioral criteria that contain must not without invariant framing", () => {
    const markdown = ["# Spec", "", "## Acceptance criteria", "", ORDINARY_MUST_NOT, ""].join("\n");
    expect(detectUnfalsifiablePremisesInMarkdown(markdown)).toEqual([]);
  });

  test("replays the retired fan-out decision bullet as unfalsifiable", () => {
    const markdown = ["# Spec", "", "## Acceptance criteria", "", FAN_OUT_VERBATIM, ""].join("\n");
    const findings = detectUnfalsifiablePremisesInMarkdown(markdown);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.criterionText).toContain(
      "Each sibling dispatch owns only its resolved destination `(project, branch)` worktree; neither destination may equal the predecessor worktree.",
    );
  });

  test("composes unfalsifiable premises ahead of at-risk hollow pins without clobbering", () => {
    const specPath = specDirWithIntent();
    writeFileSync(
      join(specPath, "00-guard.md"),
      ["# Guard", "", "## Acceptance criteria", "", UNREACHABLE_INVARIANT, "", HOLLOW_CRITERION, ""].join("\n"),
      "utf8",
    );
    const passContext = buildPlanReviewPassContext({ worktreePath: "/repo", specPath });
    expect(passContext.indexOf("## Unfalsifiable premises")).toBeLessThan(
      passContext.indexOf("## At-risk hollow pins"),
    );
    expect(passContext).toContain(PREMISE_SIGNAL);
    expect(passContext).toContain("implement-time linking may go hollow");
  });

  test("omits empty sections when only one pass has findings", () => {
    const premiseOnly = specDirWithIntent();
    writeFileSync(
      join(premiseOnly, "00-guard.md"),
      ["# Guard", "", "## Acceptance criteria", "", UNREACHABLE_INVARIANT, ""].join("\n"),
      "utf8",
    );
    const premiseContext = buildPlanReviewPassContext({ worktreePath: "/repo", specPath: premiseOnly });
    expect(premiseContext).toContain("## Unfalsifiable premises");
    expect(premiseContext).not.toContain("## At-risk hollow pins");

    const hollowOnly = specDirWithIntent();
    writeFileSync(
      join(hollowOnly, "00-guard.md"),
      ["# Guard", "", "## Acceptance criteria", "", HOLLOW_CRITERION, ""].join("\n"),
      "utf8",
    );
    const hollowContext = buildPlanReviewPassContext({ worktreePath: "/repo", specPath: hollowOnly });
    expect(hollowContext).toContain("## At-risk hollow pins");
    expect(hollowContext).not.toContain("## Unfalsifiable premises");
  });

  test("reports when a flagged premise is the sole remaining non-human-only criterion", () => {
    const markdown = ["# Spec", "", "## Acceptance criteria", "", UNREACHABLE_INVARIANT, ""].join("\n");
    const findings = detectUnfalsifiablePremisesInMarkdown(markdown);
    expect(findings[0]?.rationale).toContain("zero remaining non-human-only acceptance criteria");
  });

  test("skips human-only invariant criteria and ignores index.md, intent.md, and nested paths", () => {
    const markdown = [
      "# Spec",
      "",
      "## Acceptance criteria",
      "",
      "- [ ] Neither destination may equal the predecessor worktree. (Manual)",
      "",
    ].join("\n");
    expect(detectUnfalsifiablePremisesInMarkdown(markdown)).toEqual([]);

    const specPath = specDirWithIntent();
    writeFileSync(
      join(specPath, "index.md"),
      `# Index\n\n## Acceptance criteria\n\n${UNREACHABLE_INVARIANT}\n`,
      "utf8",
    );
    writeFileSync(
      join(specPath, "intent.md"),
      `# Intent\n\n## Acceptance criteria\n\n${UNREACHABLE_INVARIANT}\n`,
      "utf8",
    );
    mkdirSync(join(specPath, "nested"), { recursive: true });
    writeFileSync(
      join(specPath, "nested", "01-nested.md"),
      `# Nested\n\n## Acceptance criteria\n\n${UNREACHABLE_INVARIANT}\n`,
      "utf8",
    );
    expect(buildPlanReviewPassContext({ worktreePath: "/repo", specPath })).toBe("");
  });
});
