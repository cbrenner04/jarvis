import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectAtRiskHollowPinsInMarkdown } from "../mutation-checkpoint-criteria.ts";
import { buildPlanReviewPassContext, renderPlanReviewDebateRolePrompt } from "./review-plan.ts";

function specDirWithIntent(): string {
  const dir = mkdtempSync(join(tmpdir(), "plan-review-hollow-pin-"));
  writeFileSync(join(dir, "intent.md"), "# Intent\n", "utf8");
  return dir;
}

const HOLLOW_PIN_SIGNAL = "implement-time linking may go hollow";
const HOLLOW_CRITERION = '- [ ] `guard.test.ts`; // @mutate v2/src/guard.ts "a > 0" -> "a >= 0" requires a linked pin.';
const WELL_FORMED_CRITERION =
  '- [ ] `guard.test.ts` — `guard pin`; // @mutate v2/src/guard.ts "a > 0" -> "a >= 0" evidence.';

describe("plan review hollow-pin pass", () => {
  test("flags a mutation-checkpoint criterion that omits its pin title", () => {
    // @mutate shared/mutation-checkpoint-criteria.ts "if (!criterionNamesPinTitle(block))" -> "if (false)"
    const markdown = ["# Spec", "", "## Acceptance criteria", "", HOLLOW_CRITERION, ""].join("\n");
    const findings = detectAtRiskHollowPinsInMarkdown(markdown);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.criterionText).toContain("guard.test.ts");
    expect(findings[0]?.rationale).toContain("pin title");

    const specPath = specDirWithIntent();
    writeFileSync(
      join(specPath, "00-guard.md"),
      ["# Guard", "", "## Acceptance criteria", "", HOLLOW_CRITERION, ""].join("\n"),
      "utf8",
    );
    const context = { worktreePath: "/repo", specPath };
    const passContext = buildPlanReviewPassContext(context);
    expect(passContext).toContain("## At-risk hollow pins");
    expect(passContext).toContain(HOLLOW_PIN_SIGNAL);
    expect(renderPlanReviewDebateRolePrompt("adversary", context)).toContain(HOLLOW_PIN_SIGNAL);
    expect(renderPlanReviewDebateRolePrompt("advocate", context, "prior")).toContain(HOLLOW_PIN_SIGNAL);
  });

  test("does not flag a well-formed criterion that backtick-names its pin title", () => {
    const markdown = ["# Spec", "", "## Acceptance criteria", "", WELL_FORMED_CRITERION, ""].join("\n");
    expect(detectAtRiskHollowPinsInMarkdown(markdown)).toEqual([]);

    const specPath = specDirWithIntent();
    writeFileSync(
      join(specPath, "00-guard.md"),
      ["# Guard", "", "## Acceptance criteria", "", WELL_FORMED_CRITERION, ""].join("\n"),
      "utf8",
    );
    const context = { worktreePath: "/repo", specPath };
    expect(buildPlanReviewPassContext(context)).toBe("");
    expect(renderPlanReviewDebateRolePrompt("adversary", context)).not.toContain(HOLLOW_PIN_SIGNAL);
  });

  test("skips human-only mutation-checkpoint criteria", () => {
    const markdown = [
      "# Spec",
      "",
      "## Acceptance criteria",
      "",
      '- [ ] `guard.test.ts`; // @mutate v2/src/guard.ts "a > 0" -> "a >= 0". (Manual)',
      "",
    ].join("\n");
    expect(detectAtRiskHollowPinsInMarkdown(markdown)).toEqual([]);
  });

  test("ignores index.md and intent.md when scanning a spec directory", () => {
    const specPath = specDirWithIntent();
    writeFileSync(join(specPath, "index.md"), `# Index\n\n## Acceptance criteria\n\n${HOLLOW_CRITERION}\n`, "utf8");
    writeFileSync(join(specPath, "intent.md"), `# Intent\n\n## Acceptance criteria\n\n${HOLLOW_CRITERION}\n`, "utf8");
    mkdirSync(join(specPath, "nested"), { recursive: true });
    expect(buildPlanReviewPassContext({ worktreePath: "/repo", specPath })).toBe("");
  });
});
