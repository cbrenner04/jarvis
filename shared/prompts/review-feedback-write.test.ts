import { describe, expect, test } from "bun:test";
import { DEFAULT_WRITE_STEP_RULES } from "./step-rules.ts";
import {
  buildReviewFeedbackLaneContext,
  buildReviewFeedbackWritePrompt,
  REVIEW_FEEDBACK_RULES_PROMPT_ID,
  REVIEW_FEEDBACK_WRITE_PROMPT_ID,
} from "./review-feedback-write.ts";
import { loadPromptRegistry } from "./registry.ts";

const SCOPE_PHRASES = ["Do not tick", "Do not edit `index.md`", "captured PR feedback"] as const;

const SAMPLE_REVIEW_INPUT = '{"threads":[]}';

describe("buildReviewFeedbackWritePrompt", () => {
  test("registers stable prompt ids", () => {
    const registry = loadPromptRegistry();
    expect(REVIEW_FEEDBACK_WRITE_PROMPT_ID).toBe("review-feedback.prompt.write");
    expect(REVIEW_FEEDBACK_RULES_PROMPT_ID).toBe("review-feedback.rules");
    expect(registry.getById(REVIEW_FEEDBACK_WRITE_PROMPT_ID).metadata.behavior).toBe("review-feedback");
    expect(registry.getById(REVIEW_FEEDBACK_RULES_PROMPT_ID).metadata.behavior).toBe("review-feedback-rules");
  });

  test("coherence pins from review-feedback.rules Scope appear exactly once", () => {
    const prompt = buildReviewFeedbackWritePrompt({
      reviewInput: SAMPLE_REVIEW_INPUT,
      laneKind: "plan",
      entrySpecPath: "v2/spec/my-plan",
    });

    for (const phrase of SCOPE_PHRASES) {
      expect(prompt.split(phrase).length - 1).toBe(1);
    }
  });

  test("injects review input, lane kind, and lane context for each lane kind", () => {
    const intent = buildReviewFeedbackWritePrompt({
      reviewInput: SAMPLE_REVIEW_INPUT,
      laneKind: "intent",
      entrySpecPath: "/wt/ready-intents",
    });
    expect(intent).toContain(SAMPLE_REVIEW_INPUT);
    expect(intent).toContain("intent");
    expect(intent).toContain("Ready-intents root: `/wt/ready-intents`");
    expect(intent).toContain("Seed-split intent files");

    const plan = buildReviewFeedbackWritePrompt({
      reviewInput: SAMPLE_REVIEW_INPUT,
      laneKind: "plan",
      entrySpecPath: "v2/spec/2026-plan",
    });
    expect(plan).toContain("Admitted plan spec tree root: `v2/spec/2026-plan`");

    const implement = buildReviewFeedbackWritePrompt({
      reviewInput: SAMPLE_REVIEW_INPUT,
      laneKind: "implement",
      entrySpecPath: "v2/spec/2026-impl/index.md",
      projectRoot: "/wt/repo",
    });
    expect(implement).toContain("Project root: `/wt/repo`");
    expect(implement).toContain("Lane spec path (code context): `v2/spec/2026-impl/index.md`");
  });

  test("omits implement linked-index placeholder names", () => {
    const prompt = buildReviewFeedbackWritePrompt({
      reviewInput: SAMPLE_REVIEW_INPUT,
      laneKind: "implement",
      entrySpecPath: "v2/spec/2026-impl/index.md",
      projectRoot: "/wt/repo",
    });

    for (const forbidden of [
      "ACTIVE_SUBSPEC",
      "ACTIVE_SUBSPEC_PATH",
      "ACTIVE_SUBSPEC_BODY",
      "SIBLINGS_BLOCK",
      "PATCH_RULES",
      "SPEC_PATH",
    ]) {
      expect(prompt).not.toContain(forbidden);
    }
  });

  test("STEP_RULES carries review-feedback.rules and default write step rules", () => {
    const prompt = buildReviewFeedbackWritePrompt({
      reviewInput: SAMPLE_REVIEW_INPUT,
      laneKind: "plan",
      entrySpecPath: "v2/spec/tree",
    });

    expect(prompt).toContain("The final line of your response must be exactly one of:");
    expect(prompt).toContain(DEFAULT_WRITE_STEP_RULES);
    expect(prompt).toContain("# Review feedback write");
  });

  test("buildReviewFeedbackLaneContext matches lane kind shapes", () => {
    expect(buildReviewFeedbackLaneContext({ laneKind: "intent", entrySpecPath: "/ri" })).toContain(
      "Ready-intents root: `/ri`",
    );
    expect(buildReviewFeedbackLaneContext({ laneKind: "plan", entrySpecPath: "/spec" })).toContain(
      "Admitted plan spec tree root: `/spec`",
    );
    expect(
      buildReviewFeedbackLaneContext({
        laneKind: "implement",
        entrySpecPath: "spec/index.md",
        projectRoot: "/root",
      }),
    ).toContain("Project root: `/root`");
  });
});
