import { describe, expect, test } from "bun:test";
import { loadPromptRegistry } from "../../shared/prompts/registry.ts";
import { renderWriteExecutePrompt, renderWriteShrinkRules } from "./write-prompt.ts";

describe("write prompt", () => {
  test("registers stable id write.execute", () => {
    const registry = loadPromptRegistry();
    expect(registry.getById("write.execute").metadata.id).toBe("write.execute");
  });

  test("renders through shared registry contract", () => {
    const rendered = renderWriteExecutePrompt({
      specPath: "spec/example/index.md",
      stepRules: "Follow the contract.",
    });

    expect(rendered).toContain("Read the spec at spec/example/index.md.");
    expect(rendered).toContain("Follow the contract.");
  });

  test("renders all seven restraint principles", () => {
    const rendered = renderWriteExecutePrompt({
      specPath: "spec/example/index.md",
      stepRules: "Done.",
    });

    // Check for the principles section header as a stable marker
    expect(rendered).toContain("# Restraint principles");

    // Count the numbered principles (1. through 7.) to verify all seven are present
    const principleMatches = rendered.match(/^\d+\. /gm);
    expect(principleMatches?.length).toBe(7);
  });

  test("registers stable id write.shrink", () => {
    const registry = loadPromptRegistry();
    expect(registry.getById("write.shrink").metadata.id).toBe("write.shrink");
  });

  test("renders shrink rules with base diff scope and guardrails", () => {
    const rendered = renderWriteShrinkRules({ baseRef: "abc123" });

    expect(rendered).toContain("`abc123..HEAD`");
    expect(rendered).toContain("Do not regress acceptance criteria.");
    expect(rendered).toContain("Do not delete tests.");
    expect(rendered).toContain("no consumer and no spec'd future consumer");
    expect(rendered).toContain("No numeric target.");
  });
});
