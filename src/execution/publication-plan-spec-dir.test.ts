import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as sharedGit from "../shared/git.ts";
import {
  resolveReusedPlanSpecDirRelativePath,
  selectNewestBranchAddedPlanSpecBasename,
} from "./publication-plan-spec-dir.ts";

const gitSpies: Array<ReturnType<typeof spyOn>> = [];

afterEach(() => {
  for (const gitSpy of gitSpies.splice(0)) gitSpy.mockRestore();
});

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
});

describe("resolveReusedPlanSpecDirRelativePath", () => {
  test("returns undefined without listing when the plan branch is absent locally", async () => {
    gitSpies.push(spyOn(sharedGit, "branchExistsLocalAsync").mockResolvedValue(false));
    const listSpy = spyOn(sharedGit, "listTreeChildrenAtRef").mockResolvedValue([]);
    gitSpies.push(listSpy);
    expect(
      await resolveReusedPlanSpecDirRelativePath("/repo", "main", "plan/feature", "spec", "feature"),
    ).toBeUndefined();
    expect(listSpy).not.toHaveBeenCalled();
  });

  test("returns the newest branch-added matching path when the plan branch exists", async () => {
    const readyName = "feature";
    const newer = `20260201T000000Z-${readyName}`;
    gitSpies.push(spyOn(sharedGit, "branchExistsLocalAsync").mockResolvedValue(true));
    gitSpies.push(
      spyOn(sharedGit, "listTreeChildrenAtRef").mockImplementation(async (_root, ref) => {
        if (ref === "plan/feature") {
          return [{ mode: "040000", type: "tree" as const, oid: "abc", name: newer }];
        }
        return [];
      }),
    );
    expect(await resolveReusedPlanSpecDirRelativePath("/repo", "main", "plan/feature", "spec", readyName)).toBe(
      `spec/${newer}`,
    );
  });
});
