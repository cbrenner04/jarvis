import { describe, expect, test } from "bun:test";
import { locateMarkerSlice } from "../structural-test-locator.ts";
import { loadPromptRegistry } from "./registry.ts";
import { implementReviewBranchDiffProse, mergeBaseDiffMarkersFromProse } from "./review-implement.test.ts";

const IMPLEMENT_REVIEW_ADVERSARY_ID = "implement.prompt.review.adversary";

function adversaryIdentifyMarkers(adversaryBody: string): readonly string[] {
  const rules = locateMarkerSlice({
    text: adversaryBody,
    pattern: /## Rules\n\n([\s\S]+)$/,
    searchKey: "implement review adversary rules",
  });
  const findList = locateMarkerSlice({
    text: rules,
    pattern: /- Find (.+)\./,
    searchKey: "adversary identify checklist",
  });
  return findList.split(/,\s+and\s+|,\s+/).map((part) => part.trim());
}

describe("implement review role contract preservation", () => {
  const registry = loadPromptRegistry();
  const branchDiffProse = implementReviewBranchDiffProse(registry.getById("implement.prompt.review.critic").body);
  const MERGE_BASE_DIFF_MARKERS = mergeBaseDiffMarkersFromProse(branchDiffProse);
  const ADVERSARY_IDENTIFY_LIST_MARKERS = adversaryIdentifyMarkers(
    registry.getById(IMPLEMENT_REVIEW_ADVERSARY_ID).body,
  );

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
      expect(adversary).toContain(marker);
      expect(critic).not.toContain(marker);
    }
  });
});
