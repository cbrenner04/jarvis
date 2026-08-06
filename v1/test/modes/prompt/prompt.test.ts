import { describe, expect, test } from "bun:test";
import { loadPromptRegistry } from "../../../../shared/prompts/registry.ts";
import { buildPrompt } from "../../../src/modes/prompt/prompt.ts";

describe("buildPrompt", () => {
  test("includes the prompt text and Jarvis rules", () => {
    const promptText = "Fix the bug in lib/foo.ts";
    const prompt = buildPrompt(promptText);
    const documentation = loadPromptRegistry().getById("global.documentation").body.trim();
    const naming = loadPromptRegistry().getById("global.naming").body.trim();
    const terse = loadPromptRegistry().getById("global.terse").body.trim();
    const noHardWrap = loadPromptRegistry().getById("global.no-hard-wrap").body.trim();
    const rules = loadPromptRegistry().getById("prompt.rules").body.trim();

    expect(prompt).toContain("Fix the bug in lib/foo.ts");
    expect(prompt).toContain("Prompt Mode");
    expect(prompt).toBe([documentation, "", naming, "", terse, "", noHardWrap, "", rules, "", promptText].join("\n"));
  });

  test("preserves multi-line prompt text", () => {
    const promptText = "First line\nSecond line\nThird line";
    const prompt = buildPrompt(promptText);
    expect(prompt).toContain(promptText);
  });

  test("preserves special characters in prompt", () => {
    const promptText = 'Fix: $PATH issue with backticks `like this` and quotes "test"';
    const prompt = buildPrompt(promptText);
    expect(prompt).toContain(promptText);
  });
});
