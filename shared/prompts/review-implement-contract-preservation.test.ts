import { describe, expect, test } from "bun:test";
import { loadPromptRegistry } from "./registry.ts";

const ADVERSARY_IDENTIFY_LIST_MARKERS = [
  "Edge cases not addressed by the implementation",
  "Inconsistencies between the spec and the code",
  "Code quality issues: complexity, redundancy, maintainability",
  "Missing acceptance criteria or incomplete implementations",
  "Potential bugs or subtle logic errors",
] as const;

const MERGE_BASE_DIFF_MARKERS = [
  "merge-base branch diff",
  "git merge-base <base> HEAD",
  "git diff <mergeBase> HEAD",
] as const;

describe("implement review role contract preservation", () => {
  const registry = loadPromptRegistry();

  test("implement review role contract substrings preserved", () => {
    const adversary = registry.getById("implement.prompt.review.adversary").body;
    const advocate = registry.getById("implement.prompt.review.advocate").body;
    const adjudicator = registry.getById("implement.prompt.review.adjudicator").body;
    const critic = registry.getById("implement.prompt.review.critic").body;

    for (const body of [adversary, advocate, adjudicator, critic]) {
      expect(body).toContain("Read-only: do not edit or commit");
      for (const marker of MERGE_BASE_DIFF_MARKERS) {
        expect(body).toContain(marker);
      }
    }

    expect(adversary).toContain("Report problems only");

    expect(advocate).toContain("For each adversary concern");

    expect(adjudicator).toContain("Self-contained: the actuator reads only your verdict");
    expect(adjudicator).toContain("issue an empty verdict (no content)");

    expect(critic).toContain("Self-contained: the actuator reads only your verdict");
    expect(critic).toContain("empty verdict (no content)");
    for (const marker of ADVERSARY_IDENTIFY_LIST_MARKERS) {
      expect(critic).not.toContain(marker);
    }
  });
});
