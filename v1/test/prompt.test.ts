import { describe, expect, test } from "bun:test";
import { buildPrompt } from "../src/modes/patch/prompt.ts";
import { loadPromptRegistry } from "../src/prompts/registry.ts";

describe("buildPrompt", () => {
  test("asks the agent to discover repo guidance and includes Jarvis rules", () => {
    const prompt = buildPrompt("spec/2026-05-11-v1/index.md");
    const rules = loadPromptRegistry().getById("patch.rules").body.trim();

    expect(prompt).toContain(
      "Inspect the target repo for guidance, conventions, and relevant docs.",
    );
    expect(prompt).toContain("Read the spec at spec/2026-05-11-v1/index.md.");
    expect(prompt).toBe(
      [
        "Inspect the target repo for guidance, conventions, and relevant docs.",
        "Read the spec at spec/2026-05-11-v1/index.md.",
        "Follow these Jarvis rules:",
        rules,
        "Pick the single most important unchecked task and complete it.",
      ].join("\n"),
    );
    expect(prompt).not.toContain("Read README.md.");
  });

  test("passes the path through verbatim with no resolution or quoting", () => {
    const weird = "/tmp/some dir/spec.md";
    expect(buildPrompt(weird)).toContain(`Read the spec at ${weird}.`);
  });
});
