import { describe, expect, test } from "bun:test";
import {
  findSnapshotStepForRunStepId,
  isHiddenShrinkStepId,
  isWriteSiblingStepId,
  LINK_STEP_ID_INFIX,
  matchesExactStepId,
  matchesLinkedSiblingStepId,
  resolveAuthoredStepId,
  SHRINK_STEP_ID_SUFFIX,
} from "./write-sibling-step-id.ts";

const representativeSteps = [
  { stepId: "intent", role: "intent" },
  { stepId: "plan", role: "plan" },
  { stepId: "implement", role: "implement" },
  { stepId: "review", role: "review", behavior: "review" as const },
];

describe("write-sibling step id", () => {
  test("matches exact authored step ids", () => {
    // @mutate shared/write-sibling-step-id.ts "candidateStepId === stepId" -> "candidateStepId !== stepId"
    expect(matchesExactStepId("implement", "implement")).toBe(true);
    expect(matchesExactStepId("implement~link-1", "implement")).toBe(false);
    expect(matchesExactStepId(undefined, "implement")).toBe(false);
  });

  test("matches linked sibling step ids without parsing link index", () => {
    // @mutate shared/write-sibling-step-id.ts "candidateStepId?.startsWith(`${writeStepId}${LINK_STEP_ID_INFIX}`) ?? false" -> "!(candidateStepId?.startsWith(`${writeStepId}${LINK_STEP_ID_INFIX}`) ?? false)"
    expect(matchesLinkedSiblingStepId("implement~link-1", "implement")).toBe(true);
    expect(matchesLinkedSiblingStepId("implement~link-2", "implement")).toBe(true);
    expect(matchesLinkedSiblingStepId("implement~link-", "implement")).toBe(true);
    expect(matchesLinkedSiblingStepId("implement", "implement")).toBe(false);
    expect(matchesLinkedSiblingStepId("implement~shrink", "implement")).toBe(false);
  });

  test("isWriteSiblingStepId admits exact and linked rows but not hidden shrink", () => {
    // @mutate shared/write-sibling-step-id.ts "matchesExactStepId(candidateStepId, writeStepId) || matchesLinkedSiblingStepId(candidateStepId, writeStepId)" -> "matchesExactStepId(candidateStepId, writeStepId) && matchesLinkedSiblingStepId(candidateStepId, writeStepId)"
    expect(isWriteSiblingStepId("implement", "implement")).toBe(true);
    expect(isWriteSiblingStepId("implement~link-1", "implement")).toBe(true);
    expect(isWriteSiblingStepId("implement~shrink", "implement")).toBe(false);
    expect(isWriteSiblingStepId("plan~link-1", "implement")).toBe(false);
  });

  test("detects hidden-shrink ids via shared shrink suffix", () => {
    // @mutate shared/write-sibling-step-id.ts "return shrinkStepIdEndsWith(stepId)" -> "return !shrinkStepIdEndsWith(stepId)"
    expect(isHiddenShrinkStepId("implement~shrink")).toBe(true);
    expect(isHiddenShrinkStepId("step-1~shrink")).toBe(true);
    expect(isHiddenShrinkStepId("implement~link-1")).toBe(false);
    expect(isHiddenShrinkStepId("implement")).toBe(false);
    expect(isHiddenShrinkStepId(null)).toBe(false);
  });

  test("resolveAuthoredStepId maps exact, linked, and shrink run ids to authored ids", () => {
    // @mutate shared/write-sibling-step-id.ts "if (shrinkStepIdEndsWith(runStepId))" -> "if (!shrinkStepIdEndsWith(runStepId))"
    expect(resolveAuthoredStepId("implement")).toBe("implement");
    expect(resolveAuthoredStepId(`implement${LINK_STEP_ID_INFIX}1`)).toBe("implement");
    expect(resolveAuthoredStepId(`implement${SHRINK_STEP_ID_SUFFIX}`)).toBe("implement");
    expect(resolveAuthoredStepId(`step-1${LINK_STEP_ID_INFIX}3`)).toBe("step-1");
  });

  test("findSnapshotStepForRunStepId resolves representative workflow steps from run ids", () => {
    // @mutate shared/write-sibling-step-id.ts "return steps.find((step) => step.stepId === authoredStepId)" -> "return steps.find((step) => step.stepId !== authoredStepId)"
    expect(findSnapshotStepForRunStepId(representativeSteps, "implement")).toEqual(representativeSteps[2]);
    expect(findSnapshotStepForRunStepId(representativeSteps, "implement~link-2")).toEqual(representativeSteps[2]);
    expect(findSnapshotStepForRunStepId(representativeSteps, "implement~shrink")).toEqual(representativeSteps[2]);
    expect(findSnapshotStepForRunStepId(representativeSteps, "missing~link-1")).toBeUndefined();
  });
});
