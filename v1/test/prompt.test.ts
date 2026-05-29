import { describe, expect, test } from "bun:test";
import { loadPromptRegistry } from "../../shared/prompts/registry.ts";
import { buildPrompt } from "../src/modes/patch/prompt.ts";

describe("buildPrompt", () => {
  test("asks the agent to discover repo guidance and includes Jarvis rules", () => {
    const prompt = buildPrompt("spec/2026-05-11-v1/index.md");
    const documentation = loadPromptRegistry()
      .getById("global.documentation")
      .body.trim();
    const naming = loadPromptRegistry().getById("global.naming").body.trim();
    const terse = loadPromptRegistry().getById("global.terse").body.trim();
    const rules = loadPromptRegistry().getById("patch.rules").body.trim();

    expect(prompt).toContain(
      "Inspect the target repo for guidance, conventions, and relevant docs.",
    );
    expect(prompt).toContain("Read the spec at spec/2026-05-11-v1/index.md.");
    expect(prompt).toBe(
      [
        documentation,
        "",
        naming,
        "",
        terse,
        "",
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

  test("keeps sibling-directory block placement and newline joining unchanged", () => {
    const prompt = buildPrompt("spec/path.md", ["../repo-a", "../repo-b"]);
    const documentation = loadPromptRegistry()
      .getById("global.documentation")
      .body.trim();
    const naming = loadPromptRegistry().getById("global.naming").body.trim();
    const terse = loadPromptRegistry().getById("global.terse").body.trim();
    const rules = loadPromptRegistry().getById("patch.rules").body.trim();
    expect(prompt).toBe(
      [
        documentation,
        "",
        naming,
        "",
        terse,
        "",
        "Inspect the target repo for guidance, conventions, and relevant docs.",
        "Read the spec at spec/path.md.",
        "Additional project sibling directories are available for this run:",
        "- ../repo-a",
        "- ../repo-b",
        "Treat these directories as part of the target project when the active spec requires cross-repo edits.",
        "Follow these Jarvis rules:",
        rules,
        "Pick the single most important unchecked task and complete it.",
      ].join("\n"),
    );
  });
});
