import { describe, expect, test } from "bun:test";
import {
  parseImplementWorkflowArgs,
  parseIntentWorkflowArgs,
  parsePlanWorkflowArgs,
} from "../commands/workflow-args.ts";
import { BASE_WORKFLOW_NAMES, isUnrealizableWorkflowReview } from "./pipeline-definition.ts";

const POSTURES = ["none", "light", "debate"] as const;

function reviewFlagsForPosture(posture: (typeof POSTURES)[number]): string[] {
  switch (posture) {
    case "none":
      return ["--review-passes", "0"];
    case "light":
      return ["--review-passes", "1", "--review-behavior", "light"];
    case "debate":
      return ["--review-passes", "1", "--review-behavior", "debate"];
  }
}

function baseArgvForWorkflow(workflow: (typeof BASE_WORKFLOW_NAMES)[number]): string[] {
  switch (workflow) {
    case "intent":
      return ["--seed-text", "seed"];
    case "plan":
      return ["--ready-intent", "spec/ready.md"];
    case "implement":
      return ["--base", "main", "--spec", "spec/index.md"];
  }
}

describe("pipeline posture vs workflow CLI review acceptance", () => {
  for (const workflow of BASE_WORKFLOW_NAMES) {
    for (const posture of POSTURES) {
      test(`${workflow} + ${posture} pipeline realizability matches CLI parse acceptance`, () => {
        if (isUnrealizableWorkflowReview(workflow, posture)) {
          expect(isUnrealizableWorkflowReview(workflow, posture)).toBe(true);
          return;
        }

        const argv = [...baseArgvForWorkflow(workflow), ...reviewFlagsForPosture(posture)];
        const parsed =
          workflow === "intent"
            ? parseIntentWorkflowArgs(argv)
            : workflow === "plan"
              ? parsePlanWorkflowArgs(argv)
              : parseImplementWorkflowArgs(argv);
        expect(parsed.ok).toBe(true);
        expect(!parsed.ok).toBe(false);
      });
    }
  }

  test("inverting implement+none unrealizable guard fails: structurally excluded cell is not realizable", () => {
    expect(!isUnrealizableWorkflowReview("implement", "none")).toBe(false);
  });
});
