import { describe, expect, test } from "bun:test";
import { buildIntentSplitPrompt, INTENT_SPLIT_PROMPT_ID } from "./intent-split.ts";

describe("buildIntentSplitPrompt", () => {
  test("includes governed layering, file output, and optional step rules", () => {
    const prompt = buildIntentSplitPrompt({
      workdir: "/tmp/worktree",
      seedLabel: "inline",
      seedContent: "Split reporting",
      stagingDir: ".jarvis-intent-stage",
      stepRules:
        "The final line of your response must be exactly one of: done, no-work, blocked, progress, with nothing after it.",
    });

    expect(prompt).toContain("Before editing code, read the relevant durable docs/specs");
    expect(prompt).toContain("Be terse in communication artifacts");
    expect(prompt).toContain("one prerequisite behavior per physical line as `- ...`");
    expect(prompt).toContain("Write the authored intents as markdown files under `.jarvis-intent-stage`");
    expect(prompt).toContain(
      "The final line of your response must be exactly one of: done, no-work, blocked, progress, with nothing after it.",
    );
    expect(prompt).not.toContain("No planning labels in code.");
    expect(INTENT_SPLIT_PROMPT_ID).toBe("intent.prompt.split");
  });

  test("omits step completion section when stepRules is absent", () => {
    const prompt = buildIntentSplitPrompt({
      workdir: "/tmp/worktree",
      seedLabel: "inline",
      seedContent: "Split reporting",
      stagingDir: ".jarvis-intent-stage",
    });

    expect(prompt).not.toContain("## Step completion");
  });
});
