import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PATCH_REVIEW_CRITIC_PROMPT_ID,
  PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS,
  renderPatchReviewCriticPrompt,
  renderReviewDebateActuatorPrompt,
  renderReviewDebateCyclePrompts,
} from "../../../shared/prompts/review-implement.ts";

function context() {
  const cwd = mkdtempSync(join(tmpdir(), "review-render-"));
  const specPath = join(cwd, "spec");
  mkdirSync(specPath);
  writeFileSync(join(specPath, "index.md"), "# Spec", "utf8");
  return { cwd, specPath, passNumber: 1, totalPasses: 1, baseBranch: "main" };
}

describe("implement review prompt assembly", () => {
  test("keeps registered role ids and renders the light critic", async () => {
    expect(PATCH_REVIEW_CRITIC_PROMPT_ID).toBe("patch.prompt.review.critic");
    expect(PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS.adjudicator).toBe("patch.prompt.review.adjudicator");
    expect(await renderPatchReviewCriticPrompt(context())).toContain("read-only");
  });

  test("renders debate roles in order and preserves actuator verdict", async () => {
    const prompts = await renderReviewDebateCyclePrompts(context());
    expect(prompts.adversary).toContain("read-only");
    expect(prompts.advocate).toContain("no prior findings");
    expect(prompts.adjudicator).toContain("no advocate response");
    expect(renderReviewDebateActuatorPrompt("Fix the null guard", "spec/index.md")).toContain("Fix the null guard");
  });
});
