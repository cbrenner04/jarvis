import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderIntentReviewDebateRolePrompt } from "./review-intent.ts";
import { renderPlanReviewCriticPrompt } from "./review-plan.ts";
import {
  implementReviewProfile,
  intentReviewProfile,
  planReviewProfile,
  type ReviewProfileSpec,
} from "./review-profile.ts";

function extractSpecGuidance(prompt: string): string {
  const begin = prompt.lastIndexOf("<<<SPEC_GUIDANCE_BEGIN>>>");
  const end = prompt.lastIndexOf("<<<SPEC_GUIDANCE_END>>>");
  expect(begin).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(begin);
  return prompt.slice(begin, end);
}

const HUMAN_ONLY_MARKER_GUIDANCE =
  "marker strings appears anywhere in its full bullet block: `(Manual)`, `visual inspection only`, or `no automated guard`. Matching is case-insensitive substring matching across the first checklist line and any continuation lines; markers need not be trailing or whole phrases";

describe("ReviewPromptProfile", () => {
  test("defines one domain contract for light and debate review", () => {
    const profiles: ReviewProfileSpec[] = [intentReviewProfile, planReviewProfile, implementReviewProfile];

    expect(profiles.map((profile) => profile.domain)).toEqual(["intent", "plan", "implement"]);
    for (const profile of profiles) {
      expect(profile.promptIds.critic).toBeString();
      expect(profile.promptIds.actuator).toBeString();
      expect(profile.verdict).toEqual({
        source: profile.domain === "implement" ? "adjudicator" : "critic",
        empty: "stop",
        persist: "stdout",
      });
      expect(profile.boundaries.light).toEqual({ critic: "read-only", actuator: "write" });
      expect(profile.boundaries.debate).toEqual({ critic: "read-only", actuator: "write" });
    }
    expect(implementReviewProfile.promptIds.debate).toEqual({
      adversary: "implement.prompt.review.adversary",
      advocate: "implement.prompt.review.advocate",
      adjudicator: "implement.prompt.review.adjudicator",
    });
    expect(implementReviewProfile.promptIds.critic).toBe("implement.prompt.review.critic");
    expect(intentReviewProfile.promptIds.debate).toEqual({
      adversary: "intent.prompt.review.adversary",
      advocate: "intent.prompt.review.advocate",
      adjudicator: "intent.prompt.review.adjudicator",
    });
  });

  test("renders governed intent debate roles with staged content and boundaries", () => {
    const stagingDir = mkdtempSync(join(tmpdir(), "intent-review-prompt-"));
    writeFileSync(join(stagingDir, "intent.md"), "# Add API\n\n- [ ] observable outcome", "utf8");
    const context = { stagingDir, verdictPath: join(stagingDir, "verdict.md"), totalPasses: 2 };
    const adversary = renderIntentReviewDebateRolePrompt("adversary", context);
    const advocate = renderIntentReviewDebateRolePrompt("advocate", context, "finding");
    const adjudicator = renderIntentReviewDebateRolePrompt("adjudicator", context, "response");
    expect(adversary).toContain("# Add API");
    expect(adversary).toContain("Read-only");
    expect(advocate).toContain("finding");
    expect(adjudicator).toContain("response");
    expect(adjudicator).not.toContain("plan.prompt.review");
  });

  test("isolates bundled human-only guidance in v2 intent and plan review prompts", () => {
    const intentStage = mkdtempSync(join(tmpdir(), "intent-review-guidance-"));
    writeFileSync(join(intentStage, "intent.md"), "# Intent\n\nmarker-free input\n", "utf8");
    const planSpec = mkdtempSync(join(tmpdir(), "plan-review-guidance-"));
    writeFileSync(join(planSpec, "intent.md"), "# Intent\n\nmarker-free input\n", "utf8");
    writeFileSync(join(planSpec, "index.md"), "# Plan\n\n- [ ] marker-free criterion\n", "utf8");

    const intentPrompt = renderIntentReviewDebateRolePrompt("adversary", {
      stagingDir: intentStage,
      verdictPath: join(intentStage, "verdict.md"),
      totalPasses: 1,
    });
    const planPrompt = renderPlanReviewCriticPrompt({ worktreePath: "/repo", specPath: planSpec });

    expect(extractSpecGuidance(intentPrompt)).toContain(HUMAN_ONLY_MARKER_GUIDANCE);
    expect(extractSpecGuidance(planPrompt)).toContain(HUMAN_ONLY_MARKER_GUIDANCE);
  });
});
