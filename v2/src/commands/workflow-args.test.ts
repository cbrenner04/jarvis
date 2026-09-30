import { describe, expect, test } from "bun:test";
import { parseImplementWorkflowArgs, parseReviewFeedbackWorkflowArgs } from "./workflow-args.ts";

const BASE = ["--base", "main", "--spec", "spec.md"];

describe("parseImplementWorkflowArgs reset-despite flags", () => {
  test("--reset-despite-continuable sets resetDespiteContinuable only", () => {
    const parsed = parseImplementWorkflowArgs([...BASE, "--reset-despite-continuable"]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.resetDespiteContinuable).toBe(true);
    expect(parsed.resetDespiteDirty).toBeUndefined();
    expect(parsed.resetDespiteLandedCriteria).toBeUndefined();
  });

  test("omitting --reset-despite-continuable leaves resetDespiteContinuable unset", () => {
    const parsed = parseImplementWorkflowArgs(BASE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect("resetDespiteContinuable" in parsed).toBe(false);
  });
});

describe("parseReviewFeedbackWorkflowArgs", () => {
  test("--branch with a string value parses ok and returns that branch", () => {
    const parsed = parseReviewFeedbackWorkflowArgs(["--branch", "feature/review-feedback"]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.branch).toBe("feature/review-feedback");
  });

  test("rejects missing --branch", () => {
    expect(parseReviewFeedbackWorkflowArgs([]).ok).toBe(false);
  });

  test("rejects empty --branch", () => {
    expect(parseReviewFeedbackWorkflowArgs(["--branch", ""]).ok).toBe(false);
  });

  test("threads optional pipeline disambiguators when present", () => {
    const parsed = parseReviewFeedbackWorkflowArgs([
      "--branch",
      "lane-branch",
      "--pipeline",
      "pipe-1",
      "--stage",
      "stage-a",
      "--branch-key",
      "bk",
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.pipelineId).toBe("pipe-1");
    expect(parsed.stageId).toBe("stage-a");
    expect(parsed.branchKey).toBe("bk");
  });
});
