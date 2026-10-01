import { describe, expect, test } from "bun:test";
import { parsePipelineStageReviewFeedbackLaunchParams } from "./pipeline-stage-review-feedback-launch.ts";

describe("parsePipelineStageReviewFeedbackLaunchParams", () => {
  test("accepts params when branchKey is omitted", () => {
    expect(parsePipelineStageReviewFeedbackLaunchParams({ pipelineId: "p1", stageId: "s1" })).toEqual({
      ok: true,
      value: { pipelineId: "p1", stageId: "s1" },
    });
  });

  test("accepts params when branchKey is explicitly undefined", () => {
    expect(
      parsePipelineStageReviewFeedbackLaunchParams({ pipelineId: "p1", stageId: "s1", branchKey: undefined }),
    ).toEqual({
      ok: true,
      value: { pipelineId: "p1", stageId: "s1" },
    });
  });

  test("rejects empty branchKey with invalid_params message", () => {
    expect(parsePipelineStageReviewFeedbackLaunchParams({ pipelineId: "p1", stageId: "s1", branchKey: "" })).toEqual({
      ok: false,
      message: "branchKey must be a non-empty string when provided",
    });
  });

  test("includes non-empty branchKey in parsed value", () => {
    expect(
      parsePipelineStageReviewFeedbackLaunchParams({ pipelineId: "p1", stageId: "s1", branchKey: "main" }),
    ).toEqual({
      ok: true,
      value: { pipelineId: "p1", stageId: "s1", branchKey: "main" },
    });
  });
});
