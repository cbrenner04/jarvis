import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderIntentReviewDebateRolePrompt } from "./review-intent.ts";
import {
  implementReviewProfile,
  intentReviewProfile,
  planReviewProfile,
  type ReviewProfileSpec,
} from "./review-profile.ts";

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
      adversary: "patch.prompt.review.adversary",
      advocate: "patch.prompt.review.advocate",
      adjudicator: "patch.prompt.review.adjudicator",
    });
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
});
