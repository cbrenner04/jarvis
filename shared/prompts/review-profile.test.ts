import { describe, expect, test } from "bun:test";
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
      expect(profile.verdict).toEqual({ source: profile.domain === "implement" ? "adjudicator" : "critic", empty: "stop", persist: "stdout" });
      expect(profile.boundaries.light).toEqual({ critic: "read-only", actuator: "write" });
      expect(profile.boundaries.debate).toEqual({ critic: "read-only", actuator: "write" });
    }
    expect(implementReviewProfile.promptIds.debate).toEqual({
      adversary: "patch.prompt.review.adversary",
      advocate: "patch.prompt.review.advocate",
      adjudicator: "patch.prompt.review.adjudicator",
    });
  });
});
