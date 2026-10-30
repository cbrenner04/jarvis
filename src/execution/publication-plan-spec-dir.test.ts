import { describe, expect, test } from "bun:test";
import {
  matchingPlanSpecDirBasenamePattern,
  selectNewestBranchAddedPlanSpecBasename,
} from "./publication-plan-spec-dir.ts";

describe("selectNewestBranchAddedPlanSpecBasename", () => {
  const readyName = "feature";
  const older = `20260101T000000Z-${readyName}`;
  const newer = `20260201T000000Z-${readyName}`;

  test("selects the newest branch-added matching tree", () => {
    expect(
      selectNewestBranchAddedPlanSpecBasename(
        [
          { type: "tree", name: older },
          { type: "tree", name: newer },
        ],
        [],
        readyName,
      ),
    ).toBe(newer);
  });

  test("ignores matching trees already on the base ref", () => {
    expect(
      selectNewestBranchAddedPlanSpecBasename(
        [{ type: "tree", name: newer }],
        [{ type: "tree", name: newer }],
        readyName,
      ),
    ).toBeUndefined();
  });

  test("ignores suffix-only slug directories", () => {
    expect(
      selectNewestBranchAddedPlanSpecBasename([{ type: "tree", name: `not-a-timestamp-${readyName}` }], [], readyName),
    ).toBeUndefined();
  });

  test("matchingPlanSpecDirBasenamePattern requires the full timestamp prefix", () => {
    expect(matchingPlanSpecDirBasenamePattern(readyName).test(`20260101T000000Z-${readyName}`)).toBe(true);
    expect(matchingPlanSpecDirBasenamePattern(readyName).test(`not-a-timestamp-${readyName}`)).toBe(false);
  });
});
