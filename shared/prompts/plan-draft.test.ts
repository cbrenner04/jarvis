import { describe, expect, test } from "bun:test";
import { buildPlanDraftPrompt, PLAN_DRAFT_PROMPT_ID } from "./plan-draft.ts";
import { PromptRenderingError } from "./render.ts";

describe("buildPlanDraftPrompt", () => {
  test("omits runtime suffix sections when specDir and stepRules are absent", () => {
    const prompt = buildPlanDraftPrompt({
      name: "my-plan",
      intent: "do thing",
      specGuidance: "guidance",
    });

    expect(prompt).not.toContain("## File output");
    expect(prompt).not.toContain("## Step completion");
    expect(PLAN_DRAFT_PROMPT_ID).toBe("plan.prompt.draft");
  });

  test("appends file output and step completion sections when supplied", () => {
    const prompt = buildPlanDraftPrompt({
      name: "my-plan",
      intent: "do thing",
      specGuidance: "guidance",
      specDir: "/tmp/worktree/spec/2026-plan",
      stepRules:
        "The final line of your response must be exactly one of: done, no-work, blocked, progress, with nothing after it.",
    });

    expect(prompt).toContain("## File output");
    expect(prompt).toContain("Write `index.md` and numbered subspec files");
    expect(prompt).toContain("/tmp/worktree/spec/2026-plan");
    expect(prompt).toContain("Do not emit spec content to stdout");
    expect(prompt).toContain("## Step completion");
    expect(prompt).toContain(
      "The final line of your response must be exactly one of: done, no-work, blocked, progress, with nothing after it.",
    );
  });

  test("throws on delimiter-violating intent or specGuidance", () => {
    expect(() =>
      buildPlanDraftPrompt({
        name: "x",
        intent: "contains <<<INTENT_BEGIN>>>",
        specGuidance: "guidance",
      }),
    ).toThrow(PromptRenderingError);

    expect(() =>
      buildPlanDraftPrompt({
        name: "x",
        intent: "intent",
        specGuidance: "contains <<<SPEC_GUIDANCE_END>>>",
      }),
    ).toThrow(PromptRenderingError);
  });
});
