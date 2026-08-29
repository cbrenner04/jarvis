import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPlanReviewPassContext, renderPlanReviewDebateRolePrompt } from "./review-plan.ts";

function specDirWithIntent(): string {
  const dir = mkdtempSync(join(tmpdir(), "plan-review-hollow-pin-"));
  writeFileSync(join(dir, "intent.md"), "# Intent\n", "utf8");
  return dir;
}

const HOLLOW_CRITERION = '- [ ] `guard.test.ts`; // @mutate v2/src/guard.ts "a > 0" -> "a >= 0" requires a linked pin.';

describe("plan review hollow-pin pass", () => {
  test("does not inject hollow-pin findings into plan review", () => {
    const specPath = specDirWithIntent();
    writeFileSync(
      join(specPath, "00-guard.md"),
      ["# Guard", "", "## Acceptance criteria", "", HOLLOW_CRITERION, ""].join("\n"),
      "utf8",
    );
    const context = { worktreePath: "/repo", specPath };
    const passContext = buildPlanReviewPassContext(context);
    expect(passContext).toBe("");
    expect(renderPlanReviewDebateRolePrompt("adversary", context)).not.toContain(
      "implement-time linking may go hollow",
    );
    expect(renderPlanReviewDebateRolePrompt("advocate", context, "prior")).not.toContain(
      "implement-time linking may go hollow",
    );
  });
});
