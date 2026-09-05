import { describe, expect, test } from "bun:test";
import { locateMarkerSlice } from "../structural-test-locator.ts";
import { loadPromptRegistry } from "./registry.ts";
import { implementReviewBranchDiffProse, mergeBaseDiffMarkersFromProse } from "./review-implement.test.ts";

const REFERENCE_ROLE = "adversary";

function patchReviewBranchDiffProse(body: string): string {
  return locateMarkerSlice({
    text: body,
    start: "## Branch change summary\n\n",
    end: "\n\n<<<DIFF_BEGIN>>>",
    searchKey: "patch review branch change summary prose",
  });
}

function patchSummaryOnlyMarkersFromProse(prose: string): readonly string[] {
  return [
    locateMarkerSlice({ text: prose, pattern: /(not a unified diff)/, searchKey: "not a unified diff" }),
    locateMarkerSlice({
      text: prose,
      pattern: /`(git diff --stat)`/,
      searchKey: "git diff --stat",
    }).replaceAll("`", ""),
    locateMarkerSlice({
      text: prose,
      pattern: /(branch change summary)/,
      searchKey: "branch change summary",
    }),
  ];
}

/**
 * v1 patch review and v2 implement review share role names but must render distinct
 * branch-diff prose: patch stays summary-only (`git diff --stat`, not a unified diff);
 * implement supplies the merge-base unified diff. Pins the split so a future edit can't
 * silently point implement rendering back at the patch ids.
 */
describe("patch vs implement review prompt registry-body divergence", () => {
  const registry = loadPromptRegistry();
  const patchReferenceBody = registry.getById(`patch.prompt.review.${REFERENCE_ROLE}`).body;
  const implementReferenceBody = registry.getById(`implement.prompt.review.${REFERENCE_ROLE}`).body;
  const PATCH_SUMMARY_ONLY_MARKERS = patchSummaryOnlyMarkersFromProse(patchReviewBranchDiffProse(patchReferenceBody));
  const MERGE_BASE_DIFF_MARKERS = mergeBaseDiffMarkersFromProse(implementReviewBranchDiffProse(implementReferenceBody));

  test.each(["adversary", "advocate", "adjudicator"] as const)("%s branch-diff prose diverges", (role) => {
    const patchBody = registry.getById(`patch.prompt.review.${role}`).body;
    const implementBody = registry.getById(`implement.prompt.review.${role}`).body;

    expect(patchBody.length).toBeGreaterThan(0);
    expect(implementBody.length).toBeGreaterThan(0);

    const patchProse = patchReviewBranchDiffProse(patchBody);
    const implementProse = implementReviewBranchDiffProse(implementBody);

    for (const marker of PATCH_SUMMARY_ONLY_MARKERS) {
      expect(patchProse).toContain(marker);
      expect(implementProse).not.toContain(marker);
    }
    for (const marker of MERGE_BASE_DIFF_MARKERS) {
      expect(implementProse).toContain(marker);
      expect(patchProse).not.toContain(marker);
    }
    expect(implementBody).not.toEqual(patchBody);
  });
});
