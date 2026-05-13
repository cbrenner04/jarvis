import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPrompt } from "../src/modes/patch/prompt.ts";

describe("buildPrompt", () => {
  test("asks the agent to discover repo guidance and includes Jarvis rules", () => {
    const prompt = buildPrompt("spec/v1/index.md");
    const rules = readFileSync(
      join(import.meta.dir, "..", "src", "modes", "patch", "rules.md"),
      "utf8",
    ).trim();

    expect(prompt).toContain(
      "Inspect the target repo for guidance, conventions, and relevant docs.",
    );
    expect(prompt).toContain("Read the spec at spec/v1/index.md.");
    expect(prompt).toBe(
      [
        "Inspect the target repo for guidance, conventions, and relevant docs.",
        "Read the spec at spec/v1/index.md.",
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
