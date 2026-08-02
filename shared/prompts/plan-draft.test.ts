import { describe, expect, test } from "bun:test";
import { DEFAULT_WRITE_STEP_RULES } from "../../v2/src/execution/write-loop-input.ts";
import { buildPlanDraftPrompt, PLAN_DRAFT_PROMPT_ID } from "./plan-draft.ts";
import { PromptRenderingError } from "./render.ts";

const HUMAN_ONLY_STEP_RULES =
  "Human-only acceptance criteria contain `(Manual)`, `visual inspection only`, or `no automated guard` anywhere in the full bullet block (the first checklist line and any continuation lines). Recognition uses case-insensitive substring matching; markers need not be trailing or whole phrases.";

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
    expect(prompt).toContain("each added or modified guard is inverted");
    expect(prompt).toContain("suppressed effect is absent");
    expect(prompt).toContain("Documentation-only and spec-only subspecs are exempt");
  });

  test("appends file output and step completion sections when supplied", () => {
    const prompt = buildPlanDraftPrompt({
      name: "my-plan",
      intent: "do thing",
      specGuidance: "General authoring guidance.",
      specDir: "/tmp/worktree/spec/2026-plan",
      stepRules: DEFAULT_WRITE_STEP_RULES,
    });

    expect(prompt).toContain("## File output");
    expect(prompt).toContain("Write `index.md` and numbered subspec files");
    expect(prompt).toContain("/tmp/worktree/spec/2026-plan");
    expect(prompt).toContain("Do not emit spec content to stdout");
    expect(prompt).toContain("## Step completion");
    const stepRules = prompt.split("## Step completion\n\n")[1];
    expect(stepRules).toBe(DEFAULT_WRITE_STEP_RULES);
    expect(stepRules).toContain(HUMAN_ONLY_STEP_RULES);
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
